# `--no-llm` as pure merge-from-cache, plus per-unit provider/model provenance

## Context

`scv analyze` currently fuses two distinct concerns: *producing* an
artifact (functions/layers/groups/flows — each may call an LLM provider)
and *merging* whatever's cached into a snapshot. There is no way to run
each stage independently (different providers/models, different
schedules, or hand-authored via the `agent-write-pass-a-semantics` /
`agent-narrate-layers` skills) and then assemble a snapshot purely from
cache with zero provider calls.

Two concrete bugs surfaced this gap during the conversation that produced
this plan:

1. `packages/cli/src/merge-semantics.ts` — the zero-LLM path for
   externally-authored semantics — merges pending semantics into
   `.scv/artifacts/<sha>/{functions,layers}.json` but **never calls
   `finalizeSnapshot`**, so `.scv/snapshots/<sha>.json` is never written.
   Snapshots today only get produced by a full `scv analyze` run.
2. `ensureArtifact` (`packages/cli/src/artifacts.ts:297-313`) treats "never
   computed" identically to "stale" — so even `scv analyze layers` on a
   fresh sha silently triggers real LLM calls for `groups`/`flows` too,
   because `analyze.ts:117-120` unconditionally calls `ensureArtifact` on
   all four artifacts to feed `finalizeSnapshot`.

The fix direction, confirmed in conversation: redefine `--no-llm` to mean
"run the full merge, call no provider, ever — read every artifact from
cache if present, else use its declared empty default." This is safe
because `finalizeSnapshot` (`packages/interpreter/src/orchestrate.ts:875-1023`)
already tolerates partial input correctly — e.g. layers with no groups yet
parent directly to the system (line 903), which is *correct* intermediate
state, not something to avoid, and becomes correct final state once groups
run later and the snapshot is re-merged.

Once merging becomes routine across independently-run providers, the
snapshot's single `provenance.interpreter.{provider,model,prompt_rev}`
field (`packages/schema/src/index.ts:204-208`, set once by whichever call
happens to run `finalizeSnapshot` last) becomes actively misleading: it
can only name one provider/model even when functions, layers, groups, and
flows each came from a different one. Per-unit provenance
(`UnitProvenanceSchema`, `index.ts:96-99`) already exists but only carries
`source`/`pass`, not `provider`/`model`. This plan adds those fields.

Eight review cycles of this plan (folded in here, sections removed) raised
twenty points total, all addressed in the sections that follow: the
target/dependency provider policy (§ "Provider-call policy"),
`runMergeSemantics`'s real result shape (§ "Shared assemble-and-write
path"), manual-provenance semantics (§ "Manual / hand-authored
provenance"), a precise per-producer provenance table (§ "Producers to
update"), explicit empty-vs-defaulted tracking including recursive
dependency propagation (§ "Surfacing which artifacts were merged empty"),
CLI/doc text updates (§ "CLI and docs text to update"), `extraction`'s
never-defaulted special case (§ "New behavior"), the snapshot-level
provenance field's precise meaning under no-llm assembly (§
"Snapshot-level field's fate"), the schema's `"manual"` value landing in
the same change as `provider`/`model` (§ "Schema change"), Pass A's
previously-unset per-unit provenance (§ "Producers to update"), carried-over
layer narration's provider/model attribution (§ "Carried-over layer
provenance"), Pass A block-label provenance (§ "Block-label
provenance"), nested `semantics.source`/`cost.source` consistency
with a manually-merged unit's top-level provenance (§ "Manual /
hand-authored provenance"), `CostSchema.source`'s independent enum
declaration (§ "Schema change"), the persisted `Layer.source` field's own
manual-vs-llm consistency (§ "Manual / hand-authored provenance"), and
`docs/design.md`/`docs/ui-schema-inventory.md`'s `static|llm` vocabulary
going stale (§ "CLI and docs text to update"), and the emitted layer
unit's nested `semantics.source`/top-level `provenance.source` needing
the same entry-presence split already applied to the persisted `Layer`
record, rather than an unconditional `"manual"` (§ "Manual / hand-authored
provenance"), and `CostSchema`/`UnitProvenanceSchema` being unexported
internal constants, so their verification tests must go through the
exported `UnitSchema` rather than importing the narrower schemas directly
(§ "Verification").

## Relationship to `docs/plans/clusters-artifact-split.md`

That pending, unrelated plan splits `layers` into a free `clusters`
artifact (Pass B) + narration-only `layers` (Pass C), so clustering can be
previewed without an LLM call. Different intent, but both touch
`ARTIFACT_DEPENDENCIES`, `computeInputHash`, and `ARTIFACT_SCHEMA_VERSION`
in `packages/cli/src/artifacts.ts`.

**Sequencing: land `clusters-artifact-split` first.** It's smaller and
already scoped. This plan should be rebased onto that split (treating
`clusters` as a fifth artifact name) rather than proceeding in parallel,
to avoid two branches editing the same dependency table and schema
version bump independently.

## Part 1 — `--no-llm` as pure merge-from-cache

### Current behavior

`packages/cli/src/analyze.ts:93-94`:
```ts
if (options.noLlm) {
  snapshot = structural;   // short-circuits everything — no artifact merge at all
} else {
  ... ensureArtifact chain (lines 96-135) ...
}
```

### New behavior

Static/structural extraction (`extractRepo`/`toSnapshot`,
`analyze.ts:80-83`) already runs unconditionally before the `noLlm`
branch today — this does not change. `--no-llm` only changes what
happens *after*: instead of stopping at the structural snapshot, it
proceeds through the same merge path as a normal run, just without ever
calling a provider.

Remove the short-circuit. Always run the artifact-merge path; `noLlm`
instead makes `ensureArtifact` return an artifact's declared empty
default whenever it's missing or stale, instead of computing it:

- Add `ArtifactContext.noLlm?: boolean` (`packages/cli/src/artifacts.ts`).
- In `ensureArtifact` (`artifacts.ts:297-313`): when the *effective*
  no-llm flag for this call is true (see "Provider-call policy" below)
  and (`stored` is undefined or stale), return
  `emptyArtifactDefault(name, ctx)` instead of calling `computeArtifact`.
  No provider call happens under any circumstance in this mode.
- New `emptyArtifactDefault(name, ctx): ArtifactDataMap[typeof name]`
  helper, generalizing the ad-hoc pattern already at
  `merge-semantics.ts:212-216` (functions falls back to
  `ctx.snapshot.units` with empty block data):

  | Artifact | Empty default |
  |---|---|
  | extraction | n/a — always real, never optional (see below) |
  | functions | `{ units: ctx.snapshot.units, blockUnits: [], blockEdges: [] }` |
  | docs | `[]` |
  | layers | `{ layerUnits: [], layers: [], parentOverride: [], layerIdByName: [], repoContextText: undefined, clusteringVersion: CLUSTERING_VERSION, promptRev: ctx.promptRev }` |
  | groups | `{ groupUnits: [], layerParent: [] }` |
  | flows | `[]` |

  (Verified in conversation: empty `flowUnits`/`groupUnits` produce a
  valid snapshot via `finalizeSnapshot`, `orchestrate.ts:900-928`.)

  **`extraction` cannot be empty-defaulted (resolves second review point
  2):** unlike the other five, `extraction` makes no provider call in the
  first place (`computeArtifact`'s `"extraction"` case just returns
  `ctx.graph` — static AST/symbol extraction, `artifacts.ts:175-176`), so
  the entire premise of `emptyArtifactDefault` (avoid a provider call) is
  moot for it. `emptyArtifactDefault("extraction", ctx)` is never called:
  `ensureArtifact("extraction", ctx, opts)`'s `mayCallProvider` check is
  skipped for this name specifically — `extraction` always computes for
  real regardless of `opts.allowProvider`, and can never appear in
  `defaultedArtifacts`. State this as an explicit early branch in
  `ensureArtifact`, not folded into the generic no-provider path.

### Provider-call policy (resolves review point 1)

`ensureArtifact` recurses into declared dependencies
(`ARTIFACT_DEPENDENCIES`) before computing the requested artifact. "Only
the targeted artifact may call a provider" must therefore mean **the
target's full dependency closure may call a provider; everything else is
forced into no-llm mode**, not "only the exact named artifact." Example:
targeting `layers` (deps: `functions`, `docs`) allows `functions` and
`docs` to be computed for real if uncached, but `groups`/`flows` (which
depend on `layers`, not the reverse) never get touched at all — they
aren't in the dependency closure and `ensureArtifact` is never called on
them for a targeted run.

Concretely, `ensureArtifact` gains an explicit allowlist rather than a
single boolean, since a recursive call must know whether *it specifically*
is inside the allowed closure:

```ts
export interface EnsureArtifactOptions {
  /** Names allowed to call the provider on a cache miss/staleness. Absent = every
   *  artifact may call the provider (today's full-pipeline default). Present and
   *  not containing `name` = use emptyArtifactDefault instead of computing. */
  allowProvider?: ReadonlySet<ArtifactName>;
}
```

`ensureArtifact(name, ctx, opts)` passes the same `opts.allowProvider`
down to every recursive `ensureArtifact(dep, ctx, opts)` call unchanged —
the allowlist is closure-wide, computed once by the caller (below), not
re-derived at each recursion level.

Call-site derivation:
- Full `--no-llm` run: `allowProvider = new Set()` (nothing may call).
- `scv analyze <artifact>` (no `--no-llm`): `allowProvider = closureOf(artifact)`,
  i.e. `artifact` plus every name transitively reachable via
  `ARTIFACT_DEPENDENCIES` from it. A small `dependencyClosure(name):
  Set<ArtifactName>` helper walks `ARTIFACT_DEPENDENCIES` and is reused by
  both `analyze.ts` and its tests.
- Default full pipeline (no `--artifact`, no `--no-llm`): `allowProvider`
  omitted — unchanged from today, every artifact may compute for real.

New test (review point 1): `scv analyze layers` with a spy provider and
no cache for `functions`/`docs`/`layers`/`groups`/`flows` — asserts the
provider is called while producing `functions`/`docs`/`layers`, and
**never** called while producing `groups`/`flows` (those come back as
empty defaults, and are never even requested unless `finalizeSnapshot`'s
call site asks for them — see next section).

### Surfacing which artifacts were merged empty (resolves review point 5,
refined per second review point 1)

A snapshot merged with some artifacts empty-defaulted must not look
indistinguishable from a fully-computed one, and a *legitimately empty*
real artifact (e.g. a repo with no API routes, so `flows` really is `[]`
after a real Pass C run) must not be confused with a *defaulted* one
either. Track this explicitly, not by inspecting payload shape.

**Second review's blocking point**: `ensureArtifact` recurses into
dependencies before producing its own result. If `layers` is requested and
its dependency `docs` gets empty-defaulted along the way, a naive `{ data,
defaulted }` return only reports on `layers` itself — the caller never
learns `docs` was also defaulted. `assembleSnapshotFromCache` calls
`ensureArtifact` on `functions`/`layers`/`groups`/`flows` as four separate
top-level requests, so a defaulted `docs` (a dependency of `layers`, not
requested directly) would silently vanish from `emptyArtifacts`.

Fix: `ensureArtifact` accumulates defaulted names across the *entire*
recursive call, not just its own top-level result:

```ts
export interface EnsuredArtifact<T> {
  data: T;
  /** Every artifact name that was empty-defaulted anywhere in this call's
   *  dependency recursion, including `name` itself if it was defaulted.
   *  A dependency resolved from a real, fresh cache entry is never in
   *  this set, even if its own payload happens to be empty. */
  defaultedArtifacts: Set<ArtifactName>;
}

export async function ensureArtifact<N extends ArtifactName>(
  name: N,
  ctx: ArtifactContext,
  opts?: EnsureArtifactOptions,
): Promise<EnsuredArtifact<ArtifactDataMap[N]>> {
  const defaultedArtifacts = new Set<ArtifactName>();
  const deps: Partial<ArtifactDataMap> = {};
  for (const dep of ARTIFACT_DEPENDENCIES[name]) {
    const depResult = await ensureArtifact(dep, ctx, opts);
    (deps as Record<ArtifactName, unknown>)[dep] = depResult.data;
    for (const d of depResult.defaultedArtifacts) defaultedArtifacts.add(d);
  }

  const inputHash = await computeInputHash(name, ctx, deps);
  const stored = readArtifact<ArtifactDataMap[N]>(ctx, name);
  const fresh = stored && stored.inputHash === inputHash && !ctx.force.has(name);
  // extraction never calls a provider to begin with — always compute it for real,
  // regardless of allowProvider; it can never be empty-defaulted.
  const mayCallProvider = name === "extraction" || !opts?.allowProvider || opts.allowProvider.has(name);

  if (!fresh && !mayCallProvider) {
    defaultedArtifacts.add(name);
    return { data: emptyArtifactDefault(name, ctx), defaultedArtifacts };
  }
  if (fresh) return { data: stored.data, defaultedArtifacts };

  const data = (await computeArtifact(name, ctx, deps)) as ArtifactDataMap[N];
  writeArtifact(ctx, name, inputHash, data);
  return { data, defaultedArtifacts };
}
```

`defaultedArtifacts` propagates bottom-up: each recursive call merges its
dependencies' sets with its own possible default, so the outermost caller
(`assembleSnapshotFromCache`, requesting all four top-level artifacts)
gets the true union across all four calls by merging their returned sets.

- Callers needing just the data continue to work via a thin
  `ensureArtifactData(name, ctx, opts)` wrapper that unwraps `.data`, kept
  for call sites that don't care (none currently need it, but avoids
  churn in unrelated tests that already call `ensureArtifact`).
- `runAnalyze`/`runMergeSemantics`/the new shared assemble function union
  every call's `defaultedArtifacts` into one
  `emptyArtifacts: ArtifactName[]` array, returned alongside
  `snapshot`/`path`.
- CLI (`bin.ts`): when `emptyArtifacts` is non-empty, print one stderr
  line naming every defaulted artifact, e.g. — with only `functions.json`
  cached, so `docs`/`layers`/`groups`/`flows` are all empty-defaulted —
  `[WARN] snapshot merged without: docs, layers, groups, flows — run 'scv
  analyze docs' / 'scv analyze layers' / 'scv analyze groups' / 'scv
  analyze flows' for full narration`. The set must always be the
  recursive-closure union described above, not just the top-level
  requested names, so this example is exhaustive rather than
  illustrative-but-wrong.
- Applies whenever *any* artifact is empty-defaulted — not just under
  `--no-llm` — e.g. `scv analyze layers` right after
  `clusters-artifact-split` lands should also warn if groups/flows are
  still empty-defaulted (they always will be, since they're outside that
  target's dependency closure — see policy above).

New test (second review point 1): cache only `functions.json`, request
`layers` with `allowProvider: new Set()` — `docs` (a dependency of
`layers` with no cache entry) must appear in the returned
`defaultedArtifacts`/`emptyArtifacts`, not just `layers` itself.

### Shared assemble-and-write path (resolves review point 2)

`runMergeSemantics`'s actual current return type is:
```ts
export interface MergeSemanticsResult {
  merged: number;
  skipped: number;
  warnings: string[];
}
```
This plan adds a snapshot-writing step *after* `mergeSemantics(...)`
returns, so `RunMergeSemanticsResult` (the CLI-facing type; `mergeSemantics`
itself is unchanged and keeps returning `MergeSemanticsResult`) becomes:

```ts
export interface RunMergeSemanticsResult extends MergeSemanticsResult {
  snapshot: Snapshot;
  path: string;
  emptyArtifacts: ArtifactName[];
}
```

No `usage`/`elapsedMs` fields — merge-semantics never calls a provider,
so `ProviderUsage` (token/cost counts) has nothing to report; inventing a
zeroed-out `usage` object would imply a shape callers can compare against
real usage, which is misleading. `runAnalyze`'s `RunAnalyzeResult` keeps
`usage`/`elapsedMs` unchanged (it still always builds a real
`CachedProvider`, even under `--no-llm`, and reports whatever — zero —
calls happened through it).

Shared function, new file `packages/cli/src/assemble-snapshot.ts`:

```ts
export interface AssembleSnapshotOptions {
  ctx: ArtifactContext;   // ctx.noLlm effectively forced true by both call sites here
  rev: Rev;
  scvDir: string;
}
export interface AssembleSnapshotResult {
  snapshot: Snapshot;
  path: string;
  emptyArtifacts: ArtifactName[];
}
export async function assembleSnapshotFromCache(options: AssembleSnapshotOptions): Promise<AssembleSnapshotResult>
```

Body: the `ensureArtifact` × 4 (functions/layers/groups/flows, all with
`allowProvider: new Set()`) + `finalizeSnapshot` + write-to-
`.scv/snapshots/<sha>.json` block, extracted verbatim from today's
`analyze.ts:117-146`. `runAnalyze`'s `--no-llm` branch and
`runMergeSemantics` (after `mergeSemantics(...)`) both call this instead
of duplicating the block — resolves the original plan's vague "extract a
shared function" into a concrete signature, and keeps `merge-semantics.ts`
independent of `analyze.ts`'s CLI-shaped `RunAnalyzeOptions` type as
originally intended.

### `analyze.ts` changes

- Delete the `if (options.noLlm) { snapshot = structural }` branch.
- Thread `noLlm: options.noLlm ?? false` into `ArtifactContext` (kept for
  any code that still wants a simple boolean; the actual gating in
  `ensureArtifact` uses `allowProvider`, computed as described above from
  `noLlm`/`artifact`).
- Under `--no-llm`: call `assembleSnapshotFromCache` directly.
- Under a normal run: compute `allowProvider` per the policy above
  (`dependencyClosure(options.artifact)` when `artifact` is set, else
  `undefined` for the full pipeline), call `ensureArtifact` accordingly,
  then `finalizeSnapshot`, then write the snapshot — collecting
  `emptyArtifacts` the same way `assembleSnapshotFromCache` does (or by
  having `analyze.ts`'s normal path call a shared inner helper that both
  branches share; either is acceptable, the point is one no-provider
  policy resolver, not two).
- `--force` already requires `--artifact` (line 66-68). Add: `--force`
  with `--no-llm` throws (contradiction — nothing to force under
  no-llm), same style as the existing check.

### `merge-semantics.ts` changes

After `mergeSemantics(...)` writes merged pending semantics into the
`functions`/`layers` artifacts, `runMergeSemantics` calls
`assembleSnapshotFromCache(...)` using the same `ctx`/`rev`/`scvDir` it
already built, and returns `{ ...mergeResult, snapshot, path,
emptyArtifacts }` per `RunMergeSemanticsResult` above.

## Part 2 — Per-unit provider/model provenance

### Schema change

`packages/schema/src/index.ts:96-99`. Both the `provider`/`model` fields
and the `"manual"` source value are introduced together in the same
change — the "Manual / hand-authored provenance" section below stamps
`source: "manual"` on merge-semantics output, so a schema version that
still only allows `"static" | "llm"` would make that output fail
`UnitProvenanceSchema.parse` (third review point 1):

```ts
const UnitProvenanceSchema = z.object({
  source: z.enum(["static", "llm", "manual"]),  // "manual" new, alongside provider/model
  pass: z.enum(["A", "B", "C", "D"]).optional(),
  provider: z.string().optional(),  // new
  model: z.string().optional(),     // new
});
```
All new members are additive — old snapshots with `source` in
`{"static","llm"}` and no `provider`/`model` stay valid (same pattern as
`ClusteringProvenanceSchema.optional()` at `index.ts:222`). The backward
compatibility test in Verification below must parse a persisted
`{source:"llm", pass:"A"}` unit under this new enum, not the old one.

**`"manual"` must also extend `SemanticsSchema.source` and
`CostSchema.source` (resolves fifth review point 1, corrected per sixth
review point 1):** `index.ts:37` declares
`const SourceSchema = z.enum(["static", "llm"]);`, reused by
`PortSchema.source` (`index.ts:44`, optional) and `SemanticsSchema.source`
(`index.ts:64`, **required**, nested at `unit.semantics.source`) — but
**not** by `CostSchema.source`. Confirmed by direct read of
`index.ts:68-76`: `CostSchema.source` is its **own independent** inline
declaration, `source: z.enum(["static", "llm"]).optional()` (`index.ts:74`),
which happens to list the same two literal values as `SourceSchema` but
is a separate `z.enum(...)` call — extending the `SourceSchema` constant
alone, as the fifth-cycle fix stated, does **not** touch this field at
all. This was the sixth review's first blocking point, and it is correct:
the fifth-cycle plan text was wrong about `CostSchema` sharing the
constant.

Confirmed against `merge-semantics.ts`: the same hand-merge call site
that stamps `provenance: {source:"llm", pass:"A"}` (line 251, changing to
`"manual"` per "Manual / hand-authored provenance" below) *also* stamps
`{...entry.semantics, source: "llm" as const}` (line 238) and
`{...entry.cost, source: "llm" as const}` (line 244) in the same unit.
Left unchanged, this plan's fix would produce a unit whose top-level
`provenance.source === "manual"` (no provider call) directly contradicts
its own nested `semantics.source === "llm"` and `cost.source === "llm"`
(claiming a provider call did happen) — an internally inconsistent
payload.

Fix — two separate schema edits, both needed:

```ts
const SourceSchema = z.enum(["static", "llm", "manual"]);
// ...
const CostSchema = z
  .object({
    // ...
    source: SourceSchema.optional(),  // was its own z.enum(["static", "llm"]).optional() — now reuses SourceSchema
  })
  .nullable();
```
Extending `SourceSchema` itself is additive for `PortSchema` and
`SemanticsSchema` — no existing persisted value falls outside the new
enum. `CostSchema.source` additionally changes from its own inline enum
to reusing `SourceSchema` (rather than independently adding `"manual"` to
its own literal list), so the two fields can't drift apart the same way
again. `merge-semantics.ts:238` and `:244` change from
`source: "llm" as const` to `source: "manual" as const`, alongside the
`:251`/`:379` `provenance.source` change, so all three fields on a
hand-merged unit agree. New schema-parse test (sixth review point 1): a
`cost` object with `source: "manual"` parses under the updated
`CostSchema`.

### Producers to update (resolves review point 4 — every site enumerated)

Grepping `provenance:` in `packages/interpreter/src/orchestrate.ts` and
`packages/interpreter/src/groups.ts` gives the exhaustive list of sites
that construct a unit's `provenance`. Each is classified below by what it
should actually stamp:

**Correction from third review (point 2):** the table's earlier claim that
Pass A units are "unchanged — `{source:"static"}`" was wrong. Reading
`runFunctionsPass` (`orchestrate.ts:240-293`) directly: the loop that
calls `runPassA` and gets back real `result.semantics`/`result.cost`/
`result.tags`/`result.signature` from the configured provider
(`passAResultById.set(id, {...unit, semantics: result.semantics, ...})`,
line 283-290) **never touches `provenance` at all** — the spread (`...unit`)
just carries forward whatever `provenance` the incoming structural
snapshot unit already had (`{source:"static"}`, set at extraction time,
before any semantics existed). So today, a unit whose `.semantics` was
just written by a real provider call is left claiming `source:"static"`
— itself a latent mislabeling, now folded into this plan alongside the
`finalizeSnapshot` system-unit bug. A unit that hits the `catch` branch
(provider call failed, `passAResultById.set(id, unit)` with the bare
original unit, lines 274-279) correctly stays untouched/static, since no
semantics were produced.

| Site | Today | Change |
|---|---|---|
| `orchestrate.ts:283-290` — Pass A function/class/module units whose `runPassA` call succeeded | `provenance` untouched — silently inherits `{source:"static"}` from the pre-semantics structural unit | stamp `provenance: { source: "llm", pass: "A", provider: provider.name, model: provider.model }` explicitly in the `passAResultById.set(...)` object, alongside `semantics`/`cost`/`tags`/`signature` |
| `orchestrate.ts:276-279` — Pass A unit whose `runPassA` call threw (caught, logged, original unit kept) | `provenance` untouched — stays `{source:"static"}` | no change — correct as-is: no semantics were written, so `static` is accurate |
| `orchestrate.ts:353-370` — Pass A block units | `source: "static"` unconditionally, even when `labels?.get(block.id)` supplied a real LLM-produced `label` used as the unit's `name` | see "Block-label provenance" below — a block whose `name` came from a successful `runPassABlocks` call stamps `llm`/`A`/provider/model; a block that fell back to `block.condition`/`BLOCK_TYPE_FALLBACK_NAME` (label call failed or returned no entry) stays `static` |
| `orchestrate.ts:556` — Pass C layer narration (real `runLayersPass`) | `{source:"llm", pass:"C"}` unconditionally, for both freshly-narrated **and carried-over** layers | see "Carried-over layer provenance" below — freshly-narrated layers get `provider: provider.name, model: provider.model` (the *current* run's provider); carried-over layers get whatever provider/model narrated them **originally**, not the current run's |
| `orchestrate.ts:797` — Pass C flow narration | `{source:"llm", pass:"C"}` | add `provider: provider.name, model: provider.model` — already in scope in `runFlowsPass` |
| `orchestrate.ts:869` — `buildContainerUnit` ("Unclustered") | `{source:"static"}` | no change — purely structural, no provider involved, correctly marked static already |
| `orchestrate.ts:927` — the system unit, inside `finalizeSnapshot` | `{source:"llm", pass:"C"}` — **wrong**: `finalizeSnapshot` makes zero provider calls, this mislabels a pure-merge artifact as an LLM output | change to `{source:"static"}` — the system unit's shape (its child-id set) is deterministically derived from whatever units were merged in, not narrated by any call |
| `groups.ts:168` — real (non-bucket) group unit | `{source:"llm", pass:"C"}` | add `provider`/`model`, threaded from `runGroupsPass`'s `provider` param down into `buildGroupUnits`/`buildGroupUnit` (small signature addition) |
| `groups.ts:168` — `Ungrouped` bucket group unit | `{source:"static"}` (already correct — `isBucket` branch) | no change |
| `merge-semantics.ts:251` — hand-merged function/class unit's `provenance` | `{source:"llm", pass:"A"}` — no provider, since merge is provider-less | see "Manual / hand-authored provenance" below |
| `merge-semantics.ts:238` — same unit's nested `semantics.source` | `"llm"` | same fix, same call site — see "Manual / hand-authored provenance" below |
| `merge-semantics.ts:244` — same unit's nested `cost.source` | `"llm"` | same fix, same call site — see "Manual / hand-authored provenance" below |
| `merge-semantics.ts:379` — hand-merged layer unit (`mergeLayerClustering`)'s `provenance`, **both branches** (`entry`-present and `entry`-less) | `{source:"llm", pass:"C"}` unconditionally | `entry`-present → `{source:"manual", pass:"C"}`; `entry`-less (placeholder) → `{source:"static"}` — see "Manual / hand-authored provenance" below |
| `merge-semantics.ts:373` — same layer unit's nested `semantics.source`, **both branches** | `"llm"` unconditionally | `entry`-present → `"manual"`; `entry`-less (placeholder) → `"static"` — same split, same call site — see "Manual / hand-authored provenance" below |
| `merge-semantics.ts:337`/`:348` — the persisted `Layer` record's own `source` field (`layers.json`, read back by `loadPreviousLayers`/carry-over) | `"llm"` unconditionally, **for both** the `entry`-present branch (real hand-authored narration) and the `entry`-less branch (no pending narration at all, placeholder `"(no summary)"` text) | see "Manual / hand-authored provenance" below — `entry`-present becomes `"manual"`; `entry`-less becomes `"static"` (no authored content of any kind, nothing to attribute) |

`finalizeSnapshot`'s system-unit fix (`orchestrate.ts:927`) is a
correctness fix independent of the provider/model addition — worth its
own commit, since it's a plain mislabeling bug, not new functionality.

### Carried-over layer provenance (resolves third review point 3)

`runPassC` (`pass-c.ts:59-92`) carries a layer over verbatim when its
`layerId` matches a previous run's (`previous` found at line 64-68,
`layers.push({ ...previous, files: [...files] })`) — no provider call
happens for that cluster. But `Layer` itself (`pass-c.ts`'s return shape)
has no field recording *which* provider/model originally narrated it —
only a `source: "llm"` literal that's identical for every layer regardless
of which run produced it. So today, if run 1 narrates layer L with
provider X, and run 2 (configured with provider Y) carries L over
unchanged, `orchestrate.ts:556`'s unconditional `provenance: {source:
"llm", pass:"C"}` combined with this plan's naive "add
`provider: provider.name`" fix would stamp provider **Y** on a narration
Y never actually produced — attributing run 2's provider to run 1's work.

Fix: `Layer` gains its own `provider`/`model` fields, populated once at
first narration and carried forward unchanged on every subsequent
carry-over — the same "narrate once, persist, reuse" pattern the layer's
`name`/`what`/`how`/`when`/`where`/`why` fields already follow:

- `Layer` interface (wherever it's declared — `pass-c.ts` or a shared
  types module) adds `provider?: string; model?: string`.
- `runPassC`'s fresh-narration branch (`pass-c.ts:78-88`, the
  `layers.push({ name: response.name, ..., source: "llm" })` call) adds
  `provider: provider.name, model: provider.model` — `provider` is
  already in scope in `runPassC`.
- The carry-over branch (`pass-c.ts:65-68`) needs no change — `{
  ...previous, files: [...files] }` already carries `provider`/`model`
  forward unchanged along with everything else on `previous`, once the
  field exists on `Layer`.
- `orchestrate.ts:556`'s `layerUnits.push(...)` reads `provider`/`model`
  off the resolved `layer` record itself (`layer.provider`,
  `layer.model` — available after `resolveLayerNames`, which must also
  pass these fields through untouched, same as `why`/`confidence`/etc.),
  **not** off the current run's `options.provider` — this is the
  substantive fix: the unit's stamped provenance names whoever actually
  narrated that specific layer, which may be an earlier run.
- `LayersData` (`packages/cli/src/artifacts.ts`) and its persisted
  `layers.json` shape pick up the new `Layer.provider`/`.model` fields
  automatically (already round-trips the full `Layer[]` array) — no
  separate change needed there.
- Same reasoning applies to `runPassCGroups`/group narration
  (`orchestrate.ts:622`, `groups.ts:168`) if groups ever gain a similar
  carry-over path; today they don't (confirmed — `runGroupsPass` narrates
  fresh every time, no `previousGroups` parameter exists), so no change
  is needed there beyond the plain `provider`/`model` addition already in
  the table above. Note this explicitly so a future carry-over addition
  to groups doesn't reintroduce the same bug.

New test (third review point 3): narrate a layer under provider X, run
again under a **different** configured provider Y with that layer's
`layerId` unchanged (same file membership) — assert the resulting unit's
`provenance.provider === "X"`, not `"Y"`, and that a freshly-narrated
sibling layer in the same run correctly gets `"Y"`.

### Block-label provenance (resolves fourth review point 1)

`runPassABlocks` (called at `orchestrate.ts:331-338`, inside a `try`) may
return a `Map` of `block.id -> { label, ... }`. The result loop
(`orchestrate.ts:348-371`) builds every block unit unconditionally with
`provenance: { source: "static" }` (line 369) regardless of whether that
block's `name` (line 356) came from `labels?.get(block.id)?.label` (a
real LLM call succeeded and produced this specific label) or fell back to
`block.condition ?? BLOCK_TYPE_FALLBACK_NAME[...] ?? block.blockType`
(the whole `runPassABlocks` call for this function threw, caught at
line 340, `blockLabelsByFunction` has no entry for this function's
blocks — or the map lacks this specific block's id). Today every block
looks identically `static` even when its displayed name was in fact
LLM-authored — the same class of silent mislabeling as the Pass A
function/class case above, just one level down at block granularity.

Fix: distinguish per-block, not per-function, since `labels` is keyed by
individual `block.id`:

```ts
for (const block of bg.blocks) {
  childIds.push(block.id);
  const label = labels?.get(block.id);
  blockUnits.push({
    id: block.id,
    // ...
    name: label?.label ?? block.condition ?? BLOCK_TYPE_FALLBACK_NAME[block.blockType] ?? block.blockType,
    // ...
    provenance: label
      ? { source: "llm", pass: "A", provider: provider.name, model: provider.model }
      : { source: "static" },
  });
}
```

`provider` is already in scope in this loop (passed into
`runPassABlocks` two lines above). A block whose function-level
`runPassABlocks` call threw (caught, `blockLabelsByFunction` has no entry
for `unit.id`) has `labels` itself `undefined`, so every block in that
function falls to `static` — consistent with the existing per-function
catch granularity; no per-block partial-map case exists today since
`runPassABlocks` returns one label per block or fails wholesale for the
function (confirmed: its `catch` at line 340 only logs, never partially
populates `blockLabelsByFunction`).

New test (fourth review point 1): a block whose function's
`runPassABlocks` call succeeds carries `provenance.source === "llm"`,
`.pass === "A"`, and `.provider`/`.model` matching the configured
provider; a block whose function's call throws (simulate via a
throwing/spy provider) keeps `provenance.source === "static"`, and its
`name` falls back to `block.condition`/`BLOCK_TYPE_FALLBACK_NAME`/
`block.blockType` as today.

### Manual / hand-authored provenance (resolves review point 3)

`PendingSemanticsSchema` (`packages/schema/src/pending-semantics.ts`) has
an optional `meta: { createdAt?, agent?, scope? }` today — no
provider/model or explicit authorship-kind field. Marking a hand-authored
unit as `{source:"llm", pass:"A"}` with no provider is already
misleading before this plan (it implies some LLM call happened), and
adding a plain `provider: "manual"` string sentinel would silently
conflict with a real provider someday choosing that same name.

Fix, scoped to this plan:
- Extend `UnitProvenanceSchema.source` to `z.enum(["static", "llm",
  "manual"])`, adding `"manual"` as a third, first-class value (not a
  sentinel jammed into `provider`). `"manual"` means "authored by a
  human/agent with direct code context, no provider call" —
  semantically distinct from both `"static"` (mechanically derived, no
  semantics) and `"llm"` (a real provider call produced this content).
- **Fifth review point 1:** the same `"manual"` value must also apply to
  the *nested* `semantics.source`/`cost.source` fields on the same
  hand-merged unit, not just the top-level `provenance.source` — see
  "Schema change" above for the `SourceSchema` extension this requires.
  A unit is internally consistent only when all three fields agree that
  no provider call happened.
- `merge-semantics.ts:238` (`semantics.source`), `:244` (`cost.source`),
  and `:251` (`provenance.source`, `pass:"A"`) — the function/class merge
  site, which has no placeholder branch — all change from `"llm"` to
  `"manual"` together, in the same commit. `provider`/`model` stay unset
  on `provenance` (there is no provider to name).
- **The layer-merge site is different: it has two branches, and they must
  resolve differently, not both to `"manual"`** (resolves seventh review's
  blocking point). `mergeLayerClustering`'s emitted `layerUnits.push(...)`
  object (`:359-380`) is built from the same `entry`-presence branch that
  determines the persisted `Layer.source` split below — `:373`
  (`semantics.source`) and `:379` (`provenance.source`) must follow the
  identical split, not change unconditionally:
  - `entry`-present (real hand-authored narration matched this cluster):
    `:373` → `"manual"`; `:379` → `{source: "manual", pass: "C"}`.
  - `entry`-less (no pending narration matched this cluster; the emitted
    unit's `semantics` fields are all the `"(no summary)"` placeholder
    text built at `:348`): `:373` → `"static"`; `:379` → `{source:
    "static"}` (no `pass` — nothing was narrated, matching how `:480`'s
    `buildContainerUnit`/`:869` case omits `pass` for non-narrated static
    units).
  - This mirrors the persisted `Layer.source` split at `:337`/`:348`
    exactly — a placeholder layer with no real content must not claim
    `"manual"` authorship any more than it should claim `"llm"`; only a
    layer with actual matched narration (from either source) gets an
    authorship claim beyond `"static"`.
- **The persisted `Layer` record itself (resolves sixth review point 2):**
  `Layer.source` (`packages/interpreter/src/pass-c.ts:30`) is declared
  `source: "llm"` — a single-value literal type, narrower even than the
  schema's two-value enum, because until this plan every `Layer` really
  was LLM-narrated. `mergeLayerClustering` (`merge-semantics.ts:325-349`)
  constructs a `Layer` in two branches: `entry`-present (real
  hand-authored narration from the pending file) stamps `source: "llm"`
  at line 337; `entry`-less (no pending narration matched this cluster,
  placeholder `"(no summary)"` text throughout) stamps the *same*
  `source: "llm"` at line 348. Both are wrong under this plan, and in two
  different ways — the `entry`-present case should read `"manual"` (real
  content, no provider call); the `entry`-less case should read
  `"static"` (no authored content of any kind — nothing to attribute to
  a provider, human, or agent). Left unfixed, a later `loadPreviousLayers`
  carry-over (`artifacts.ts:279-295`) would read this record back and
  propagate the wrong claim into a *subsequent* run's freshly-carried-over
  unit, independent of the one-time merge fix above.
  - Widen `Layer.source` to `source: "static" | "llm" | "manual"`
    (`pass-c.ts:30`) — matching the schema-level three-value vocabulary
    this plan already introduces elsewhere, so the interpreter-internal
    type and the schema type say the same thing.
  - `merge-semantics.ts:337` → `source: "manual"`; `:348` →
    `source: "static"`.
  - `runPassC`'s own fresh-narration branch (`pass-c.ts:78-88`, per
    "Carried-over layer provenance" above) is unaffected — it always
    produces real narration via a real provider call, so `source: "llm"`
    there remains correct as-is.

New test (sixth review point 2): merging a pending layer file where one
cluster has a matching `entry` and a sibling cluster has none — the
persisted `layers.json`'s `Layer.source` reads `"manual"` for the former
and `"static"` for the latter; re-running analysis afterward (simulating
a carry-over read via `loadPreviousLayers`) preserves that same
distinction on the carried-over record, not a blanket `"llm"`.

New test (seventh review point 1): the same merge, asserting on the
**emitted layer units** in `layerUnits` (not the persisted `Layer`
records covered above) — the matched cluster's unit has
`semantics.source === "manual"` and `provenance.source === "manual"`;
the unmatched/placeholder cluster's unit has `semantics.source ===
"static"` and `provenance.source === "static"`. This is a distinct
assertion from the sixth-cycle test: that test can pass while this one
fails if the emitted-unit branch is left unconditionally `"manual"`
while only the persisted-record branch is correctly split.
- `pending.meta.agent` (already optional in the schema) is the closest
  existing field to "who authored this" — not required by this plan, but
  note it in the pending-semantics schema doc comment as the place an
  agent should self-identify (e.g. `"agent-write-pass-a-semantics"`) so a
  future consumer can distinguish authoring skills without a schema
  change.
- Backward compatibility: an older pending file / older snapshot with no
  `meta.agent` and `source: "llm"` from a pre-this-plan merge-semantics
  run stays valid (schema change is additive) but keeps reading as `llm`
  — no migration is performed on existing `.scv/` caches; only newly
  written data uses `"manual"`.

New tests (review point 3, plus fifth review point 1): merging a pending
file with no `meta` field produces units with `provenance.source ===
"manual"`, `semantics.source === "manual"`, and (when a cost was
supplied) `cost.source === "manual"` — never `"llm"` on any of the three;
a consumer reading an old cached artifact where all three were already
persisted as `"llm"` (pre-this-plan) still parses under the updated
`SourceSchema`/`UnitProvenanceSchema` without throwing.

### Snapshot-level field's fate (resolves second review point 3)

`SnapshotProvenanceSchema.interpreter.{provider,model,prompt_rev}`
stops being a reliable single-provider claim once stages merge
independently. **Recommendation: keep it, redefine its meaning** to "the
provider/model of whichever merge/analyze call most recently wrote this
snapshot file" (weak but simple, no consumer breakage) — per-unit
provenance becomes the source of truth for per-unit attribution. Do not
remove the snapshot-level field in this plan; that would need a grep
across `packages/server` and any snapshot consumers first, out of scope
here.

Second review flagged this as ambiguous in practice: `runAnalyze
--no-llm` still constructs `ArtifactContext` with a real, configured
`Provider` (`.scv/config.yaml`'s default, e.g. `ollama`) even though that
provider is never actually called under no-llm mode — while
`runMergeSemantics` builds its `ArtifactContext` with a distinct
`noopProvider` (`merge-semantics.ts`, confirmed in source) that names no
real provider at all. If `finalizeSnapshot` naively stamped
`ctx.provider.name`/`ctx.provider.model` into
`SnapshotProvenanceSchema.interpreter` in both cases, the field would say
`"ollama"` for a run that made zero ollama calls, and something like
`"none"` for a merge-semantics run — neither is "the provider that
produced this content," and the two are inconsistent with each other for
what is structurally the same situation (no-llm assembly from cache).

Resolved meaning, stated explicitly at the field's declaration
(`packages/schema/src/index.ts:204-208`): **`interpreter.provider`/`.model`
name the provider *configured for this call*, not a claim that it was
actually invoked** — i.e. "the writer," matching what the field already
means today for a normal full run (a normal run's `finalizeSnapshot` call
is only ever reached after that provider was in fact used for whatever it
computed). Concretely:
- `runAnalyze` (with or without `--no-llm`) stamps the real configured
  `ctx.provider.name`/`.model`, unchanged from today — `--no-llm` does not
  swap in a different provider value here, it only prevents that
  provider from being called.
- `runMergeSemantics` stamps a literal `"none"`/`undefined` (whatever
  `noopProvider` already reports for `.name`/`.model` — check its actual
  fields, keep as-is if already sensible) — reflecting that no
  configured provider drove this write at all, which is accurate: nothing
  was even nominally in charge of it.
- Document both cases side by side at the schema declaration so a future
  reader sees the field means "nominal writer of the snapshot file," and
  that per-unit `provenance` (Part 2) is the only reliable source for
  "was this content actually produced by a provider call."

`extraction`'s special status (above) is unaffected: it never involves
`ctx.provider` regardless of run mode.

## CLI and docs text to update (resolves review point 6)

- `packages/cli/src/bin.ts:24` — `.option("--no-llm", "extraction only —
  skip all LLM passes, write a static-only snapshot")` is now wrong;
  change to describe the new behavior, e.g. `"merge from cache only —
  never call a provider; artifacts with no cache use an empty default"`.
- `packages/cli/src/analyze.ts:37-38` — the `RunAnalyzeOptions.noLlm`
  doc comment (`"Stop after extraction — no LLM passes run, snapshot
  contains only static units/edges."`) gets the same rewrite.
- `packages/cli/src/analyze.ts:55-61` — the `runAnalyze` doc comment
  above the function needs a line noting `--no-llm` still runs the full
  merge/finalize path, just with every artifact forced through
  `emptyArtifactDefault` where uncached.
- `packages/cli/src/bin.ts:66` — the `merge-semantics` command
  description (`"...into the artifact cache — no LLM calls"`) gains
  "...and writes a merged snapshot" once `runMergeSemantics` does so.
- Add a one-line note to `docs/design.md` (wherever artifact caching is
  currently documented — check via grep for "ensureArtifact" or
  "--no-llm" there) cross-referencing this plan's redefinition, so the
  architecture doc doesn't silently drift from actual CLI behavior.
- **`docs/design.md` and `docs/ui-schema-inventory.md`'s `static|llm`
  vocabulary (resolves sixth review point 3):** `design.md:98,103,134`
  and `ui-schema-inventory.md:36,44` all describe unit/port/semantics
  `source` as the two-value `static|llm`. Update both to `static|llm|manual`
  wherever `source`/`provenance` is described, in the same commit as the
  schema change — these are the contract documents a future reader checks
  first, and letting them silently list a stale enum defeats the purpose
  of documenting the vocabulary at all.
- **Consumer compatibility note**: anything reading
  `snapshot.provenance.interpreter` expecting it to name the provider for
  *every* unit (rather than just "whichever call wrote the file last")
  should be flagged — grep `packages/server` for
  `provenance.interpreter` / `.interpreter.provider` before merging Part
  2, and note any such consumer inline in the PR description even if no
  code change is needed there.

## Verification (TDD per project convention)

1. **Part 1** — new/updated tests (`packages/cli/test/artifacts.test.ts`,
   `packages/cli/test/analyze.test.ts`, `packages/cli/test/merge-semantics.test.ts`
   or wherever these currently live), written first (failing):
   - `ensureArtifact` with `allowProvider: new Set()` never calls
     `provider.*` (spy/counting provider, assert zero calls) and returns
     `{ data: emptyArtifactDefault(...), defaultedArtifacts: {name} }` for
     any artifact with no fresh cache entry.
   - `ensureArtifact` with a real cached (non-stale) artifact returns an
     empty `defaultedArtifacts` even under `allowProvider: new Set()` — a
     fresh cache hit is not a default.
   - Cache only `functions.json`, request `layers` with `allowProvider:
     new Set()` — `docs` (a dependency defaulted along the way, never
     requested at the top level) appears in the returned
     `defaultedArtifacts`, not just `layers` itself (second review point
     1 regression test).
   - `ensureArtifact("extraction", ctx, { allowProvider: new Set() })`
     still computes for real (spy provider — irrelevant here, `extraction`
     never touches `ctx.provider` — but assert the real graph comes back,
     not a default) and never appears in `defaultedArtifacts` (second
     review point 2 regression test).
   - `scv analyze --no-llm` on a repo with only `functions.json` cached
     writes a snapshot with functions' semantics present and
     docs/layers/groups/flows empty — no crash, no provider call —
     `emptyArtifacts` is exactly `["docs", "layers", "groups", "flows"]`
     (deterministic set, matching whichever artifacts actually had no
     fresh cache entry — `docs` included, per the recursive-closure fix
     above; third review point 4).
   - `scv analyze --no-llm --force` throws.
   - `scv analyze layers` (no `--no-llm`, spy provider) on a fresh sha
     with no cached `functions`/`docs`/`layers`/`groups`/`flows`: calls
     the provider while producing `functions`/`docs`/`layers` (the
     target's dependency closure), never for `groups`/`flows` —
     regression test for today's force-compute bug, and for the
     `dependencyClosure`/`allowProvider` policy above.
   - After a `merge-semantics` run (functions pending file only),
     `RunMergeSemanticsResult.path` names a written
     `.scv/snapshots/<sha>.json`, and its functions-derived units carry
     the merged semantics; `emptyArtifacts` includes `layers`/`groups`/`flows`.
   - `assembleSnapshotFromCache` is covered directly: called twice with
     different partial cache states (functions-only, then
     functions+layers) produces a snapshot each time, and the second call
     correctly reparents layers under a group once one becomes cached
     between calls (validates the "re-finalize, not incremental merge"
     design this plan relies on).
2. **Part 2**:
   - A unit produced by `runFunctionsPass`/`runLayersPass`/`runGroupsPass`/
     `runFlowsPass` under provider X carries `provenance.provider ===
     X.name` and `provenance.model === X.model`, independent of what
     provider produced other units in the same merged snapshot.
   - A unit whose `runPassA` call succeeds carries `provenance.source ===
     "llm"`, `provenance.pass === "A"`, and `provenance.provider`/`.model`
     matching the configured provider — regression test for the
     previously-unset-provenance bug (third review point 2); a unit whose
     `runPassA` call throws (caught) keeps `provenance.source === "static"`.
   - A block whose function's `runPassABlocks` call succeeds carries
     `provenance.source === "llm"`, `.pass === "A"`, and
     `.provider`/`.model` matching the configured provider; a block whose
     function's call throws (caught) keeps `provenance.source ===
     "static"` (fourth review point 1 regression test).
   - Narrate a layer under provider X, then re-run with a differently
     configured provider Y but unchanged file membership for that layer
     (same `layerId`) — the resulting unit's `provenance.provider ===
     "X"` (the original narrator), not `"Y"`; a freshly-narrated sibling
     layer in the same second run correctly gets `"Y"` (third review
     point 3 regression test).
   - The system unit built by `finalizeSnapshot` carries
     `provenance.source === "static"` (regression test for the
     mislabeling fix), regardless of what provider produced its children.
   - `mergeSemantics` output units carry `provenance.source === "manual"`,
     `semantics.source === "manual"`, and `cost.source === "manual"`
     (when a cost was supplied) — never `"llm"` on any of the three
     fields on the same unit (fifth review point 1 regression test).
   - A `cost` object with `source: "manual"` parses successfully as part
     of a full unit, asserted through the exported `UnitSchema.parse(...)`
     (sixth review point 1 regression test — `CostSchema.source` was its
     own inline enum, not a `SourceSchema` reuse, so extending
     `SourceSchema` alone would not have covered this). `CostSchema` and
     `UnitProvenanceSchema` are unexported internal constants in
     `packages/schema/src/index.ts` (eighth review's non-blocking note) —
     tests exercise them only indirectly, through `UnitSchema.parse` on a
     full unit fixture, not by importing the narrower schemas directly.
   - Merging a pending layers file where one cluster has a matching
     `entry` and a sibling cluster has none: the persisted `Layer.source`
     in `layers.json` reads `"manual"` for the matched cluster and
     `"static"` for the unmatched one; a subsequent carry-over read
     preserves that distinction rather than collapsing both to `"llm"`
     (sixth review point 2 regression test).
   - Same merge, asserted on the **emitted layer units** (`layerUnits`,
     distinct from the persisted `Layer` records above): the matched
     cluster's unit has `semantics.source === "manual"` and
     `provenance.source === "manual"`; the unmatched/placeholder
     cluster's unit has `semantics.source === "static"` and
     `provenance.source === "static"` — not both unconditionally
     `"manual"` (seventh review point 1 regression test).
   - `UnitSchema.parse` accepts a pre-existing persisted unit whose
     `provenance` is `{source: "llm", pass: "A"}` with no `provider`/
     `model` fields (backward compatibility; asserted through the
     exported `UnitSchema`, per the note above — `UnitProvenanceSchema`
     itself is not exported).
   - `runAnalyze --no-llm`'s written snapshot has
     `provenance.interpreter.provider` equal to the *configured* provider
     name even though zero calls to it occurred; `runMergeSemantics`'s
     written snapshot has whatever `noopProvider` reports (e.g. `"none"`)
     — both assert the field names the nominal writer, not a claim of
     actual invocation (second review point 3 regression test).
3. `npm test` && `npm run lint` at repo root.
4. Manual dogfood: run functions via one provider, author layers by hand
   via `agent-narrate-layers` + `merge-semantics`, then `scv analyze
   --no-llm`; confirm the snapshot has both stages' data, correct
   per-unit provider attribution (`llm` with provider name for
   functions, `manual` for hand-authored layers), the stderr warning
   naming `groups`/`flows` as empty, and no provider network call
   observed.

## Git workflow

Branch `feature/no-llm-merge-provenance`, created after
`clusters-artifact-split` merges to main. Implement as separate commits:
(a) the `finalizeSnapshot` system-unit mislabeling fix (small,
independent correctness fix), (b) Part 1 (`--no-llm` reframe,
`allowProvider` policy, `assembleSnapshotFromCache`, empty-artifact
surfacing), (c) Part 2 (schema `"manual"`/`provider`/`model` addition — extending
shared `SourceSchema` for `PortSchema`/`SemanticsSchema`, and separately
switching `CostSchema.source` to reuse `SourceSchema` instead of its own
inline enum — Pass A per-unit and per-block provenance fixes,
carried-over `Layer` provider/model tracking and its own `source` field
widening to `"static" | "llm" | "manual"`, `groups.ts`/`merge-semantics.ts`
provenance updates including nested `semantics.source`/`cost.source`,
manual-source handling, and `docs/design.md`/`docs/ui-schema-inventory.md`
vocabulary updates). `npm test` / `npm run lint` →
`project-review` skill → push → PR → merge, per project convention (this
touches schema + two packages' src, well above the "<10 lines"
direct-merge bar).

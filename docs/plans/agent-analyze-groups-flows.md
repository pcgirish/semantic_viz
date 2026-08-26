# Rename skills + add agent-analyze-groups and agent-analyze-flows

## Context

`agent-narrate-layers` lets an agent write layer narration and merge it into
scv's cache without an LLM call, by piggybacking on Pass B (file clustering),
which is already free/deterministic. Investigating why `scv analyze groups
--no-llm` produced no groups surfaced that **groups and flows have no free
structural pass to piggyback on** the way layers does:

- **Groups**: Pass C invents *both* membership (which layers cluster
  together) and a name, in one LLM call (`runPassCGroups` in
  `packages/interpreter/src/orchestrate.ts`). There's no Pass-B-for-groups.
  Also: today, real Pass-C groups ship with `semantics: null` by design
  (`packages/interpreter/src/groups.ts:152-155`) — the code explicitly
  refuses to narrate groups until "a group-narration pass lands" for the
  *real LLM pipeline*. The agent-authored path is a deliberate, scoped
  exception to that: the UI's `Inspector.tsx` (`packages/ui/src/Inspector.tsx:172-191`)
  is generic over `unit.semantics` for any unit kind — it already renders
  What/How/When/Where/Why when present and falls back to "Not yet available"
  when `null`, with no `kind === "group"` special-casing anywhere in
  `packages/ui/src` (confirmed via grep — only `Legend.tsx`/`edge-budget.ts`
  reference `kind === "group"`, both for graph layout, not semantics
  rendering). So the agent-authored skill **may** author group narration
  (what/how/when/where/why) in addition to membership — it will render
  correctly in the UI today, and doing so does not touch or need to touch
  `buildGroupUnit`'s real-pipeline defaults. The real Pass C pipeline's
  narration (removing the `semantics: null` default, adding a real
  group-narration LLM call) is separate future work, tracked independently —
  this plan only adds narration to the agent-authored merge path.
- **Flows**: tracing (`traceFlow`/`traceFlowBranching` over structural
  `callEdges`) is deterministic and free. Only two things call the LLM:
  `proposeFlowEntryPoints` (which functions are API entry points) and
  `narrateFlow` (what/how/when/where/why for a traced chain). Structural
  route hints (`graph.routes`) already exist and are unioned in regardless
  of what the LLM proposes — so an agent can supply entry points from real
  route hints and author narration for the (already-deterministic) traced
  steps, exactly parallel to how `agent-narrate-layers` narrates real Pass B
  clusters.

Separately, the user wants "pass-a"/"pass-c" jargon out of skill names.
Renaming to `agent-analyze-<artifact>` names by *what's produced*, not by
internal pipeline stage — consistent across all four skills.

## Renames (no behavior change)

- `.agents/skills/agent-write-pass-a-semantics/` → `.agents/skills/agent-analyze-functions/`
  (`.claude/skills/` is a symlink to `.agents/skills/`, so nothing else to update there)
- `.agents/skills/agent-narrate-layers/` → `.agents/skills/agent-analyze-layers/`
- Update `name:` frontmatter in both `SKILL.md` files to match new dir names.
- Grep the repo for the old names (`agent-write-pass-a-semantics`,
  `agent-narrate-layers`) repo-wide — `CLAUDE.md`, other skill files, docs,
  and any schema comments — and update every reference, not just the obvious
  ones. Exception: this plan document itself necessarily names the old
  skills when explaining what's being renamed from (this section, the
  Context section above) — those references describe the rename, they are
  not live pointers to the old dirs, and are exempt from the sweep.

## Bug fix (pre-existing, surfaced by review): `mergeLayerClustering` destroys unmentioned layer narration

`mergeLayerClustering` (`packages/cli/src/merge-semantics.ts:292-400`)
rebuilds **every** real Pass-B cluster on each run. For any real cluster
with no matching entry in *this* pending file, it writes a fresh layer unit
with `what/how/when/where/why: "(no summary)"`, `confidence: 0`,
`source: "static"` — unconditionally, even if that layer was narrated (by a
prior agent-analyze-layers run or a real LLM pass) and is sitting fully
narrated in the current cached `layers` artifact right now. The skill's own
docs say an agent may narrate only a subset of clusters per run; today doing
so silently wipes every other layer's narration the moment
`--with-clustering` runs. This predates this plan but must be fixed as part
of it, since `agent-analyze-layers` is being renamed/touched here and the
same "rebuild from pending only" pattern is the template `mergeGroups`
would otherwise copy.

Fix: before building each layer record, read the **current sha's own
currently-cached** `layers` artifact (see the `readArtifact` details below).

`LayersData` (`packages/cli/src/artifacts.ts`) splits the cached data across
two parallel arrays built in lockstep by the same loop in
`mergeLayerClustering`: `layers: Layer[]` (from `packages/interpreter/src/pass-c.ts`)
holds the flat `name`/`what`/`how`/`when`/`where`/`why`/`confidence`/`source`/
`provider`/`model` fields, and `layerUnits: Unit[]` holds the `Unit`-shaped
records whose `semantics` object and `provenance` are *derived from* the
matching `Layer` record at build time.

Today's loop (`merge-semantics.ts:379-400`) derives both fields off raw
`entry` presence — `semantics: { what: layer.what, ..., source: layer.source }`
and, separately, `provenance: entry ? {source:"manual",pass:"C"} : {source:"static"}`.
That second derivation is the actual bug: it is keyed on whether *this run's*
pending file mentions the cluster, not on where the layer's data came from.
Simply carrying the cached `Layer` record forward (as the fix below does) is
not enough on its own — the `provenance` line would still see no `entry` for
an unmentioned cluster and stamp it `{source:"static"}`, discarding a
previously-real LLM or manual layer's provenance even once its narration
text is correctly preserved.

Fix by restructuring the loop around a single **effective layer** per
cluster, computed once and used for both `layers` and `layerUnits`:

```
effectiveLayer = entry-derived layer (pending entry present this run)
              ?? carried-forward cached Layer (stored.data.layers entry
                 whose layerIdFor(files) === realId, when source !== "static")
              ?? static placeholder ("(no summary)", confidence 0, source: "static")
```

Read `stored.data.layers` via `readArtifact<ArtifactDataMap["layers"]>(ctx, "layers")`
in `packages/cli/src/artifacts.ts`, the same primitive `ensureArtifact` uses
internally. `readArtifact` is currently module-private to `artifacts.ts` —
add `export` to its declaration so `merge-semantics.ts` can call it
directly. (Not `loadPreviousLayers`: that function walks *ancestor* shas
looking for a prior commit's cache and is for cross-commit carry-over; it
explicitly does not read the current sha's own artifact, which is what's
needed here.)

Push `effectiveLayer` onto `layers: Layer[]` unchanged (it is already a
`Layer`, whichever branch produced it — carrying it forward means literally
reusing the cached record, not rebuilding it field-by-field). Build the
`layerUnits` entry's `semantics` from `effectiveLayer` exactly as today
(`{ what: effectiveLayer.what, ..., source: effectiveLayer.source }`), and
derive `provenance` from `effectiveLayer.source` instead of from `entry`
presence:

- `effectiveLayer.source === "manual"` → `{ source: "manual", pass: "C" }`
  (this is the shape a pending entry produces this run, and also what a
  carried-forward previously-manual layer already had).
- `effectiveLayer.source === "llm"` → carry forward `{ source: "llm", pass: "C", provider: effectiveLayer.provider, model: effectiveLayer.model }`
  verbatim from whatever the cached layer's real provenance was — confirmed
  via `packages/interpreter/src/pass-c.ts`'s `runPassC`, real LLM-narrated
  layers set `source: "llm"`, `provider: provider.name`, `model: provider.model`
  on the `Layer` record itself, so `effectiveLayer.provider`/`.model` are
  always present when `source === "llm"` and can be copied straight into
  `provenance` without needing to look anywhere else.
- `effectiveLayer.source === "static"` → `{ source: "static" }` (today's
  fallback, unchanged).

This replaces the current fallback branch, which sets `layer.name = realId`
unconditionally when there's no pending entry — silently renaming a
previously-authored layer back to its raw id, and resetting
`what`/`how`/`when`/`where`/`why` to `"(no summary)"` and provenance to
`static`, on any run where that layer isn't in the current pending file.
Only fall back to the static placeholder (today's behavior, unchanged) when
there is neither a pending entry nor a prior cached `Layer` with
`source !== "static"` for that cluster (e.g. first run, or a genuinely new
cluster). Add a test: merge layer A with narration and a custom name, then
in a second `--with-clustering` run merge only layer B — assert layer A's
`name` and narration fields are unchanged, not reset, in both `layers` (the
`Layer[]` array) and `layerUnits` (the derived `Unit[]`); additionally
assert `source`/`provider`/`model` are unchanged on the `Layer[]` record
(`Layer` has no `provenance` field — those three fields carry provenance
directly) and `provenance` is unchanged on the corresponding `layerUnits`
`Unit` record (`Unit.provenance` is the object; `Layer` has no such field).
Add a second case seeding layer A's cached record with `source: "llm"` (as
if a real Pass C narrated it) and confirm a later `--with-clustering` run
that doesn't mention layer A carries its `provider`/`model` forward
unchanged on the `Layer[]` record and its equivalent `provenance.provider`/
`.model` forward unchanged on the `layerUnits` record.

## Clarifications to existing skill docs (non-blocking, from review)

Apply alongside the renames above, to both the renamed
`agent-analyze-functions` and `agent-analyze-layers` docs:

- `agent-analyze-functions`: currently states test/generated units are
  excluded "exactly like real Pass A," implying a runtime guarantee.
  `mergeSemantics`'s function-merge path only validates unit existence and
  kind match — it does not itself filter test/generated paths. Reword this
  as authoring guidance ("the agent should not submit narration for
  test/generated units") rather than an enforced invariant, unless this
  plan also adds that filter to the merge path (out of scope here — no
  evidence it's needed for groups/flows).
- `agent-analyze-layers`: currently states running the functions skill
  first is required for layer narration quality. The manual layer-merge
  path does not read function semantics when constructing layer units, so
  today this ordering has no effect on `--with-clustering` output. Keep the
  stated ordering requirement only if `mergeGroups`/`mergeFlows` (this plan)
  end up depending on functions being narrated first for their own quality
  — otherwise drop the claim from the layers skill doc rather than leave an
  unenforced, ineffective requirement in place.
- Both skill docs (and the new groups/flows docs below): the prescribed
  `.scv/pending/<sha>/semantics-<artifact>.json` filename is a convention
  the CLI does not enforce — `merge-semantics` accepts any file path and
  never checks that its name or directory matches the sha it's merging
  against. State this explicitly as "a convention, not a requirement" in
  each skill doc so an agent doesn't assume misnaming will be caught.

## Schema change: `packages/schema/src/pending-semantics.ts`

Add two new optional-by-default record fields to `PendingSemanticsSchema`,
alongside existing `units`/`layers`:

```ts
groups: z.record(z.string(), PendingGroupSchema).default({}),
flows: z.record(z.string(), PendingFlowSchema).default({}),
```

```ts
const PendingGroupSchema = z.object({
  name: z.string().min(1).max(40),
  layers: z.array(z.string()).min(1), // layer NAMES, resolved to ids at merge time
  what: z.string(), how: z.string(), when: z.string(),
  where: z.string(), why: z.string(),
  confidence: z.number().min(0).max(1),
});

const PendingFlowSchema = z.object({
  name: z.string().min(1),
  route: z.string().min(1),
  entryUnit: z.string().min(1),       // unit id of the entry-point function
  what: z.string(), how: z.string(), when: z.string(),
  where: z.string(), why: z.string(),
  tags: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
});
```

The pending group key (`groups.<key>`) is an arbitrary agent-chosen label —
it is **not** the real group id, which `buildGroupUnits` derives from a hash
of resolved member layer ids (`groupIdFor` in `groups.ts`) and cannot be
known until after membership resolves. Matching pending entries to built
group units happens by **member-id set**, not by key (see merge step below).

Unlike the real Pass C pipeline, `PendingGroupSchema` carries narration
fields — the agent-authored path is a deliberate, scoped exception to
Pass C's current "groups are unnarrated" default (see Context above).

## `packages/cli/src/merge-semantics.ts`: new merge paths

Add `--with-groups` and `--with-flows` flags (independent of
`--with-clustering`, since groups/flows each depend on layers/functions
respectively, not on each other). Both follow the existing
`mergeLayerClustering` shape: read real structural output, resolve pending
entries against it, write the artifact under the same `computeInputHash`
formula `ensureArtifact` uses so a later `scv analyze` sees a fresh match.

**`mergeGroups(ctx, pendingGroups, warnings)`**

1. Require the `layers` artifact to be fresh, checked **transitively**, not
   by comparing `layers`'s own stored hash against one freshly computed from
   whatever `clusters`/`functions` files happen to be on disk. A shallow
   check like that can pass even when `clusters` or `functions` is itself
   stale relative to *its* own deps (e.g. `extraction` changed since
   `functions` was last written) — `layers`'s stored hash would still match
   a `computeInputHash` call fed those stale `clusters`/`functions`
   contents, since both sides read the same (stale) files. `ensureArtifact`
   (`packages/cli/src/artifacts.ts`) avoids exactly this by resolving each
   dependency through a recursive `ensureArtifact` call before hashing, so
   staleness anywhere in the chain propagates up. Reuse that directly: call
   `ensureArtifact("layers", ctx, { allowProvider: new Set() })` — not the
   `ensureArtifactData` wrapper, which discards the `defaultedArtifacts` set
   this check needs. Passing an empty `allowProvider` set means any stale
   artifact anywhere in the chain is empty-defaulted rather than triggering
   a provider call, so this never makes an LLM call. If the result's
   `defaultedArtifacts` set contains `"layers"` (`ensureArtifact`'s
   recursion folds a stale transitive dependency into the same set, so this
   one check covers `clusters`/`functions`/`extraction` staleness too),
   error with an actionable message (e.g. "layers artifact is missing or
   stale — run `scv analyze <root> layers` first") rather than silently
   building groups against outdated layer data. Otherwise use the result's
   `.data` as the `layers` artifact for the rest of `mergeGroups`.
2. Resolve layer names to ids **per pending entry**, not via
   `resolveGroupMembership` as a single all-or-nothing call.
   `resolveGroupMembership` throws on the *first* unknown name or name
   collision across the whole input, which is right for Pass C (a single
   LLM response, fail the batch) but wrong here — one agent typo should not
   discard every other correctly-specified group. Build the same
   `idsByName` lookup `resolveGroupMembership` builds internally (layer name
   → id, collision if a name is not unique among real layers) once, then
   for each pending group entry: look up each of its `layers` names; if any
   name is unknown or ambiguous, push a warning
   (`group "<key>" references unknown/ambiguous layer "<name>" — skipped`)
   and skip that whole entry. Within one entry's `layers` list, reject
   repeated names rather than silently deduping or passing them through:
   push a warning (`group "<key>" lists layer "<name>" more than once —
   skipped`) and skip the whole entry — `buildGroupUnits`'s `claimedBy` map
   throws a double-ownership error on a repeated id even within a single
   group's own member list, so an unresolved duplicate here would abort the
   whole `buildGroupUnits` call, not just this entry. Otherwise collect the
   entry's resolved (now known-unique) layer ids.
3. Reject/skip (with a warning) any pending group whose resolved layer ids
   overlap another pending group's — `buildGroupUnits` throws on double
   ownership, and a thrown error here would abort the merge for every other
   valid entry. Check overlaps across surviving entries before calling
   `buildGroupUnits`.
4. Reject/skip (with a warning) any surviving pending entry whose `name`
   duplicates another surviving entry's `name`
   (`group name "<name>" is used by more than one pending entry — skipped`,
   naming the colliding pending keys) **before** building the object passed
   to `buildGroupUnits` — that object is keyed by `name`, so two entries
   sharing a name would silently overwrite one another as object keys and
   only one group would ever reach `buildGroupUnits`. Then call
   `buildGroupUnits({ layerUnits, groups: resolved, systemId, provider: noopProvider })`
   from `packages/interpreter/src/groups.ts`, unmodified — it still returns
   groups with `semantics: null` and `provenance.source: "llm"`/`"static"`,
   which is correct for the real pipeline and must stay that way. Pass
   `groups` keyed by each surviving pending entry's (now known-unique)
   `name` field (not its arbitrary pending key) since that's what becomes
   the group unit's `name`/`qualname`.
   `buildGroupUnit` only reads `provider.name`/`provider.model` for
   provenance when not the ungrouped bucket — pass the existing
   `noopProvider` const (already defined in this file) since its `.name`/`.model`
   fields are readable without ever calling `.interpret()`.
5. Any layer not claimed by a pending group falls into the "Ungrouped"
   bucket automatically (existing `buildGroupUnits` behavior — no new code).
6. **In `mergeGroups`, not in `groups.ts`**: match each returned `groupUnit`
   back to its source pending entry by comparing `groupUnit.children`
   (sorted member layer ids) against each surviving entry's resolved id set
   — not by `groupUnit.id`, which is a hash the pending file cannot predict.
   For each match, overwrite:
   - `semantics`: `{ what, how, when, where, why, confidence, source: "manual" }`
     from the pending entry
   - `provenance`: `{ source: "manual", pass: "C" }`
   - `hash.semantic`: recompute via `semanticHashInput(groupUnit.name, groupUnit.semantics)`
     (same helper `groups.ts` imports from `@scv/schema`) — the built unit's
     `hash.semantic` was computed against `semantics: null`; leaving it
     unrecomputed after overwriting `semantics` makes the hash lie about
     what it covers, and a later diff/re-narration pass would compare a
     stale hash against real content and see no change.
   The synthetic "Ungrouped" bucket (`id === UNGROUPED_ID`) never gets
   pending narration (no pending group can target it) and keeps
   `semantics: null` and its original `hash.semantic`.
7. Write `groups` artifact via `computeInputHash("groups", ctx, { layers, functions })`.

**`mergeFlows(ctx, pendingFlows, functionUnits, warnings)`**

1. Resolve the `functions` artifact the same way `mergeSemantics`'s own
   top-level function-merge path already does (`merge-semantics.ts:231-236`):
   `readArtifact<FunctionsData>(ctx, "functions")`, falling back to
   `{ units: ctx.snapshot.units, blockUnits: [], blockEdges: [] }` when no
   `functions` artifact has ever been persisted — a plain `scv analyze
   --no-llm` run defaults missing artifacts rather than writing them, so
   "no `functions` artifact yet" is a legitimate, common zero-LLM state, not
   an error case. But if a `functions` artifact **is** present on disk, it
   must be verified fresh, not read blindly: call
   `ensureArtifact("functions", ctx, { allowProvider: new Set() })` (same
   pattern as `mergeGroups`'s `layers` check above) and error if its
   `defaultedArtifacts` set contains `"functions"` — a stale persisted
   `functions` artifact silently traces flows against outdated units/
   semantics, which is worse than falling back to the live snapshot. Use
   `ensureArtifact`'s `.data` (when fresh) or the snapshot fallback (when
   never persisted) as `functionsData` for the rest of `mergeFlows`; a
   present-but-stale artifact is the only error case. Add tests for both:
   no persisted `functions` artifact → falls back to snapshot units, merge
   succeeds; a persisted-but-stale `functions` artifact (e.g. extraction
   changed since it was written) → `mergeFlows` errors rather than tracing
   against it.
2. Rebuild `callEdges` and DI
   handling **exactly** as `runFlowsPass` does in
   `packages/interpreter/src/orchestrate.ts` (lines ~684-836), not a
   simplified subset — the real pipeline splices DI dependencies in as a
   linear prefix ahead of the handler and builds `stepsBranching` by
   wrapping the body's branching trace with that DI prefix
   (`diSteps.reduceRight(...)`). Reusing this logic verbatim (factor the
   `callEdges`/DI-prefix construction out of `runFlowsPass` into a shared
   helper both it and `mergeFlows` call, rather than duplicating it) is
   required: a merged flow whose DI dependencies or branch labels
   diverge from what the real pipeline would produce is not "the same
   artifact under manual provenance," it's a different, wrong one.
3. For each pending flow entry: validate `entryUnit` exists in
   `unitById` **and** is a function unit (same `LEAF_KINDS`/non-test filter
   `runFlowsPass` applies to build `flowUnitSummaries`) — otherwise warn and
   skip. Two pending entries resolving to the same flow id (same route +
   same traced steps, per the hash `runFlowsPass` uses) is a collision;
   keep the first and warn on the rest, matching the skip/warn tone used
   elsewhere in this file.
4. Call `traceFlow`/`traceFlowBranching` (exported from
   `packages/interpreter/src/checker.ts` and re-exported via
   `packages/interpreter/src/index.ts` — `traceFlow` already is;
   `traceFlowBranching` is not yet in that re-export list and needs adding)
   over the shared callEdges/DI-prefix helper from step 2 to get
   `steps`/`stepsBranching` deterministically — no LLM.
5. Build the `api_flow` unit using the same shape `runFlowsPass` builds
   (id hash from `route` + `steps`, `hash.semantic: null` — the real
   pipeline never sets it for flows either, so no stale-hash risk here
   unlike groups), substituting pending narration for `narrateFlow()`'s LLM
   output and `provenance: { source: "manual", pass: "C" }` instead of
   `"llm"`.
6. Write `flows` artifact — `ArtifactDataMap["flows"]` is `Unit[]` directly
   (confirmed in `packages/cli/src/artifacts.ts`) — via
   `computeInputHash("flows", ctx, { functions })`.

**Scope limit: DI/branching parity only holds for the live-extraction case.**
`mergeFlows` above assumes `ctx`'s graph came from a live `extractRepo(...)`
call (real `graph.edges` with `via: "di"` markers, real `graph.blockGraph`).
That assumption breaks when `merge-semantics` is run with `--sha` against a
historical/persisted revision: `runMergeSemantics`'s `--sha` branch loads a
persisted `scv/1` Snapshot and rebuilds a `SymbolGraph` via
`graphFromSnapshot` (`packages/cli/src/merge-semantics.ts`), which
hardcodes `blockGraph: {}` and `routes: []` — and the snapshot it's
rebuilding from never had DI information in the first place, since `toEdge`
(`packages/cli/src/snapshot.ts`) does not copy the extractor's `via` field
onto the schema's `Edge` type when a `SymbolGraph` is persisted. So for a
`--sha`-reconstructed graph there are no DI edges to splice as a prefix and
no block graph to trace branches through — `traceFlowBranching` has nothing
real to branch over, and any DI prefix `mergeFlows` produced would be
silently empty, not merely approximate.

This is a structural limitation of the current snapshot storage contract,
not a gap this plan closes: fixing it would mean persisting `via` on `Edge`
and persisting `blockGraph`/routes into the snapshot format, which is a
schema change out of scope here. `mergeFlows` therefore explicitly supports
only the live-extraction case (no `--sha`, or `--sha` resolving to the
current HEAD's live re-extraction). When `ctx` was built from a persisted
snapshot (`graphFromSnapshot`) rather than live extraction, `mergeFlows`
must error rather than silently produce a flow with no DI prefix and empty
branching: e.g. "flow merging requires live extraction; historical --sha
merges are not supported (no DI/block-graph data is persisted)." The Tests
section below only asserts DI/branching parity for the live case; add one
test confirming `--with-flows` against a `--sha`-sourced `ctx` errors
instead of producing a silently-degraded flow.

Wire both into `mergeSemantics()` next to the existing
`if (withClustering) { ... }` block, and into `MergeSemanticsOptions` /
`RunMergeSemanticsOptions` / the CLI's `merge-semantics` command options in
`packages/cli/src/bin.ts` (`--with-groups`, `--with-flows`, alongside
`--with-clustering`).

## Tests (TDD — write first)

`packages/cli/test/merge-semantics.test.ts`: add cases modeled on the
existing `--with-clustering` tests (same `writePending`/`ctx` fixtures):

- `--with-clustering`, partial-narration preservation (bug fix above):
  merge a pending file narrating layer A with a custom name, then in a
  second `--with-clustering` run merge a pending file narrating only layer
  B → assert layer A's `name`/`what`/`how`/`when`/`where`/`why`/`confidence`/
  `source` in `layers` (the `Layer[]` array) and layer A's `name`/`semantics`/
  `provenance` in `layerUnits` (the derived `Unit[]`) are both unchanged
  from the first run, not reset to `realId`/`"(no summary)"`/`confidence: 0`/
  `source: "static"`.
- `--with-groups`, happy path: pending group referencing real layer names by
  name → merged group unit has correct `children` (resolved layer ids),
  `layerParent` map updated, unclaimed layers land in "Ungrouped". Merged
  group's `semantics` matches the pending entry's
  `what`/`how`/`when`/`where`/`why`/`confidence` with `source: "manual"`,
  `provenance` is `{ source: "manual", pass: "C" }`, and `hash.semantic` is
  recomputed (differs from a group built with `semantics: null`). The
  "Ungrouped" bucket keeps `semantics: null` and its original hash.
- `--with-groups`, renamed group: same member layer ids, different `name` in
  the pending entry than any Pass-C-style default would produce — confirms
  matching is by resolved member-id set, not by the pending file's key or by
  `groupUnit.id`.
- `--with-groups`, per-entry failure isolation: one pending group references
  an unknown layer name, a second pending group is valid → the valid group
  merges successfully with a warning only for the invalid one (not an
  all-or-nothing throw).
- `--with-groups`, overlapping claim: two pending groups both claim the same
  layer id → the second is skipped with a warning, the first still merges.
- `--with-groups`, duplicate group name: two pending entries both set
  `name: "X"` → both are skipped with a warning naming the colliding
  pending keys, no group named "X" is built, other valid entries still
  merge.
- `--with-groups`, duplicate member name: one pending entry's `layers` lists
  the same layer name twice → the entry is skipped with a warning, no
  double-ownership error propagates out of `buildGroupUnits`, other valid
  entries still merge.
- `--with-flows`: pending flow with a real `entryUnit` id (a function with a
  DI dependency, to exercise the DI-prefix path) → merged `api_flow` unit
  has `steps`/`stepsBranching` matching what `runFlowsPass`'s own trace
  would produce for that entry point, narration from pending, id hash
  matches the real hashing scheme. Unknown or non-function `entryUnit` →
  warning/skip, not throw. Two pending entries producing the same flow id →
  second is skipped with a warning.
- `--with-flows`, historical-sha rejection: `ctx` built from
  `graphFromSnapshot` (persisted-snapshot path, e.g. via `--sha`) →
  `mergeFlows` errors rather than producing a flow with an empty DI prefix.
- `--with-flows`, no persisted `functions` artifact: fresh `ctx` with no
  prior `scv analyze` run for `functions` → `mergeFlows` falls back to
  `ctx.snapshot.units` and merges successfully (matches the existing
  fallback `mergeSemantics` already uses for the top-level function-merge
  path).
- `--with-flows`, stale persisted `functions` artifact: write a `functions`
  artifact, then change something the `functions` hash depends on (e.g.
  extraction) without re-running `scv analyze functions` → `mergeFlows`
  errors rather than tracing against the stale cached units.
- inputHash determinism: re-running with identical pending produces the same
  `inputHash` for both `groups` and `flows` (no spurious recompute on a
  later plain `scv analyze`).

## Skill docs

`.agents/skills/agent-analyze-groups/SKILL.md` — modeled on
`agent-analyze-layers`'s structure:
intro explaining groups have no free structural pass (unlike layers) so
this skill supplies *both* membership judgment and narration, and that
unlike `agent-analyze-flows` there is no snapshot fallback here — a fresh
`layers` artifact is required before this skill can merge, since group
membership has no deterministic structural pass to fall back to (a prior
`scv analyze <root> layers` run or a prior `--with-clustering` merge both
produce one); procedure
(run `scv analyze <root> layers` for real layer names first, write
`.scv/pending/<sha>/semantics-groups.json` with `{ groups: { <key>: { name,
layers: [...], what, how, when, where, why, confidence } } }` — note the
`<key>` is just a label for the pending file, not the eventual group id, run
`scv merge-semantics ... --with-groups`). Notes explicitly that this is a
deliberate, scoped exception to the real Pass C pipeline, which still ships
groups with `semantics: null` by design (see `groups.ts`) until a real
group-narration LLM pass lands as separate future work — the agent-authored
path is not blocked on that and diverges intentionally.

`.agents/skills/agent-analyze-flows/SKILL.md` — intro explaining tracing is
free/deterministic, only entry-point choice and narration are agent-authored;
note that `functions` may come from a real `scv analyze <root> functions`
run *or*, if none has been run yet, `mergeFlows` falls back to the live
structural snapshot automatically — no separate zero-LLM prep step is
strictly required, though running `functions` first gives real unit ids and
semantics to reference. Procedure (run `scv analyze <root> functions` for
real unit ids and `graph.routes`/structural hints first, write
`.scv/pending/<sha>/semantics-flows.json` with `{ flows: { <id>: { name,
route, entryUnit, what, how, when, where, why, tags, confidence } } }`, run
`scv merge-semantics ... --with-flows`); notes that `entryUnit` must be a
real function unit id or the entry is skipped with a warning.

Keep each `SKILL.md` short: purpose, required artifacts, the pending JSON
shape, the merge command, and the constraints/failure behavior an agent must
know before writing a pending file (unknown-name handling, per-entry
isolation, the `--sha`-not-supported limit for flows, etc.). Design
rationale, implementation mechanics (e.g. how `mergeGroups` matches by
member-id set, the DI-prefix helper reuse), and the test plan belong in this
document, not duplicated into the skill docs.

Update `CLAUDE.md`'s skills table with the two new rows and renamed names.

## Implementation order

Dependency-ordered, to avoid building on top of not-yet-fixed code:

1. Renames (skills dirs, frontmatter, repo-wide reference sweep).
2. Layer-cache preservation bug fix in `mergeLayerClustering` (blocks
   nothing else directly, but fixes the pattern `mergeGroups` must not
   copy).
3. Schema change: `PendingGroupSchema`/`PendingFlowSchema` in
   `packages/schema/src/pending-semantics.ts`.
4. Shared helpers: factor `runFlowsPass`'s callEdges/DI-prefix construction
   into a helper usable by both `runFlowsPass` and `mergeFlows`; add
   `traceFlowBranching` to `packages/interpreter/src/index.ts`'s re-export
   list.
5. Merge paths (`mergeGroups`, `mergeFlows`) and CLI flags
   (`--with-groups`, `--with-flows`) in `merge-semantics.ts`/`bin.ts`.
6. Skill docs (`agent-analyze-groups`, `agent-analyze-flows`) plus the
   clarifications to the renamed `agent-analyze-functions`/
   `agent-analyze-layers` docs, and the `CLAUDE.md` skills table update.
7. Tests and the manual smoke-test pass.

## Verification

- `npm test` (packages/cli, packages/interpreter, packages/schema) — new
  merge-semantics tests pass, existing `--with-clustering` tests unaffected.
- `npm run lint`.
- Manual end-to-end smoke test against a fixture repo (not
  `eq_to_word_problem`, per project convention — use `fixtures/` or a scratch
  repo): `scv analyze --no-llm`, hand-write a pending groups/flows file per
  the new skill docs, `scv merge-semantics ... --with-groups --with-flows`,
  confirm `.scv/artifacts/<sha>/groups.json` and `flows.json` are populated
  and a subsequent `scv analyze` reuses them (no provider call, per the
  `[INFO] progress` log / `usage: calls=0`).
- Follow repo git workflow: branch `feature/agent-analyze-groups-flows`,
  implement, verify, `project-review` skill, push, PR.

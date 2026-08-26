# Complete the agent-analyze skill suite (+ fix flowchart loss)

## Context

`scv analyze` has six artifact stages — `functions | docs | clusters | layers |
groups | flows` — but only four have skills (`agent-analyze-functions`,
`-layers`, `-groups`, `-flows`, all shipped in PR #144). Two problems follow
from the gaps:

**1. The agent-analyze path silently destroys flowcharts.** Block units
(function-internal control flow, powering the Flowchart view) are *pure AST
structure* — `orchestrate.ts:344-348` says so explicitly: "Block units are pure
AST structure … no LLM/layer/group context needed." But they are built *inside*
`runFunctionsPass`, the LLM pass. Every zero-LLM path therefore hardcodes them
empty:

- `packages/cli/src/artifacts.ts:257` (Pass A flush), `:396` (empty default)
- `packages/cli/src/merge-semantics.ts:281, 519, 526, 740` — all four merge paths

So a repo analyzed entirely via the skills gets no flowcharts at all, even
though the data costs nothing to compute. There is an *optional* LLM sub-pass
(Pass A-blocks, `orchestrate.ts:362-368`) that adds readable block labels, and
it already has a structural fallback on failure — so labels are an enhancement,
not a requirement.

**2. `docs` is a real LLM pass with no skill.** `runDocsPass` takes
`ctx.provider` (`artifacts.ts:286`) and makes one call per README/docs file.
It is the one genuine coverage gap among the six stages.

Separately, `clusters` (Pass B) is deterministic — `pass-b.ts:19` records that
it is "no longer an LLM pass (plan 4c)" and `runClustersPass` takes no provider
argument. But it *consumes* `deps.functions` and `deps.docs`, both LLM-derived,
so clustering quality still depends on those being narrated first. That
dependency is invisible today and worth making explicit.

**Outcome:** every stage gets exactly one skill, flowcharts work on every
zero-LLM path, and one umbrella skill produces a complete scv snapshot end to
end without a single provider call.

## Decisions (settled with the user)

- Flowchart fix: **extract a deterministic block builder**, called by the merge
  paths — not authored by hand in the pending file.
- Block *labels* ride along in `agent-analyze-functions`' pending file (matching
  the real pipeline's optional-enhancement-over-fallback shape). No separate
  `agent-analyze-flowchart` skill.
- Two thin deterministic skills: `agent-analyze-structure`, `agent-analyze-clusters`.
- Add `agent-analyze-docs` and umbrella `agent-analyze-repo`.

## Part A — Deterministic block builder (the flowchart fix)

Factor the block-construction loop out of `runFunctionsPass`
(`packages/interpreter/src/orchestrate.ts:349-448`) into a new exported
function in a new file `packages/interpreter/src/blocks.ts`:

```ts
export function buildBlockUnits(
  units: Unit[],
  graph: SymbolGraph,
  labels?: Map<string, Map<string, BlockLabelWithProvenance>>,   // see A.1
): { unitsWithBlockChildren: Unit[]; blockUnits: Unit[]; blockEdges: Edge[] }
```

It contains today's logic verbatim (`orchestrate.ts:395-448`): walk function
units, read `graph.blockGraph[qualname]`, mint block units parented under the
function, emit `control_flow` edges with `flowType`. When `labels` is absent or
lacks an entry, use the existing structural fallback (`block.condition ??
BLOCK_TYPE_FALLBACK_NAME[block.blockType]`) — the same fallback the pass already
uses when the label call fails.

`runFunctionsPass` then calls `buildBlockUnits(units, graph, blockLabelsByFunction)`
instead of inlining the loop. Behavior for the real pipeline is unchanged.

`runFunctionsPass` wraps its Pass A-blocks output in `BlockLabelWithProvenance`
(§A.1) at that call site — it is the only place holding the provider.

Re-export `buildBlockUnits`, `BlockLabelWithProvenance`, and the existing
`BlockLabel` type (`packages/interpreter/src/pass-a-blocks.ts:31-38`) from
`packages/interpreter/src/index.ts`.

### A.1 — Block labels are not stored separately (governs A.2 and Part A tests)

Confirmed in `orchestrate.ts:400-436`: a label is **not** a separate field. It is
baked in at build time as the block unit's `name`, the outgoing edge's
`edgeLabel`, and `provenance.source`:

- labeled block → `name = label.label`, `provenance = { source: "llm", pass: "A", provider, model }`
- unlabeled block → `name = condition ?? blockTypeFallback`, `provenance = { source: "static" }`
- `true`/`false` edges carry `edgeLabel` from the source block's `trueLabel`/`falseLabel`

**Consequence:** labels in a cached `functions` artifact are
recoverable without a pending file. `recoverBlockLabels(cachedBlockUnits,
cachedBlockEdges)` reads back every block whose `provenance.source !== "static"`,
taking `label` from `name` and `trueLabel`/`falseLabel` from its outgoing labeled
edges. Merge paths call this on the cached artifact and pass the result into
`buildBlockUnits`, so a merge that changes only unit semantics preserves existing
block labels rather than resetting them to structural text.

**Provenance must travel with the label.** `BlockLabel`
(`pass-a-blocks.ts:31-38`) holds only `label`/`trueLabel`/`falseLabel`, while the
builder's labeled branch hardcodes `{ source: "llm", pass: "A", provider, model }`.
Recovering an agent-authored label and passing it back through that API would
**relabel it as LLM**, breaking §A.2's `source: "manual"` rule and the
label-preservation test. `BlockLabel` is also the Pass A-blocks LLM response
type, so it must not grow provenance fields the model is expected to emit.

Resolve by keeping the two concerns in separate types. `buildBlockUnits` takes a
distinct input type rather than raw `BlockLabel`:

```ts
/** A label plus where it came from. `BlockLabel` stays the LLM response shape. */
export interface BlockLabelWithProvenance {
  label: BlockLabel;
  provenance: UnitProvenance;   // the same union already on Unit.provenance
}

labels?: Map<string, Map<string, BlockLabelWithProvenance>>
```

The builder writes `provenance` through verbatim instead of synthesizing it, so:
- Pass A-blocks wraps its `BlockLabel`s with `{ source: "llm", pass: "A", provider, model }`
  at the call site in `runFunctionsPass` — the only place that knows the provider.
- `mergeSemantics` wraps pending labels with `{ source: "manual", pass: "A" }`.
- `recoverBlockLabels` returns the cached block's **own** `provenance` object
  unchanged, so a recovered manual label stays manual and a recovered LLM label
  keeps its original provider/model rather than being re-stamped with the current
  one.

No serialization change: provenance is already persisted on each block unit, and
`BlockLabel` itself stays exactly as it is on the wire.

### A.2 — Pending block-label schema

Block unit ids are opaque — `resolve.ts:420` mints
`u:block:${shortHash(qualname + ":" + blockId)}` — so an agent **cannot predict
them**. Labels are therefore keyed by the readable per-function `blockId`
(`"decision:0"`, `"loop:1"`), which `buildBlockUnits` resolves to the global id
using the same `graph.blockGraph[qualname]` entry it is already walking.

Add to `packages/schema/src/pending-semantics.ts`:

```ts
const PendingBlockLabelSchema = z.object({
  label: z.string().min(1).max(60),
  trueLabel: z.string().min(1).max(24).optional(),
  falseLabel: z.string().min(1).max(24).optional(),
});
```

and one optional field on the existing `PendingUnitSchema`:

```ts
blockLabels: z.record(z.string(), PendingBlockLabelSchema).optional(),  // keyed by blockId
```

Merge rules, enforced in `mergeSemantics`:
- A `blockLabels` key not present in that function's real `blockGraph` → warn +
  skip that label, keep the rest (per-entry isolation, matching `mergeGroups`).
- `trueLabel`/`falseLabel` on a non-`decision`/`loop` block → warn + skip those
  two fields; the `label` still applies.
- **Precedence:** pending label > recovered cached label > structural fallback.
- **Provenance:** an agent-authored label sets
  `{ source: "manual", pass: "A" }` — not `"llm"`, consistent with how every
  other merged field in this file is marked. `recoverBlockLabels` must treat
  both `"llm"` and `"manual"` as labeled.
- The skill doc must tell the agent to read real `blockId`s from
  `.scv/artifacts/<sha>/extraction.json`'s `blockGraph` (after
  `agent-analyze-structure`) rather than guessing them. That artifact is
  `ctx.graph` verbatim (`artifacts.ts:247-248`) and is the only place the
  readable per-function `blockId`s survive — the snapshot keeps only the opaque
  `u:block:<shortHash>` ids, and `blockGraph` is not persisted there at all.

### A.3 — Remove every unintended empty-block site

There are **six** sites, not five: `artifacts.ts:257` and `:396`, and
`merge-semantics.ts:281`, `:519`, `:526`, `:740`.

- `merge-semantics.ts`: compute blocks once near the top of `mergeSemantics`
  (via `buildBlockUnits` with labels resolved per A.1/A.2) and use that value at
  all four sites.
- `artifacts.ts:396` (`emptyArtifactDefault`): build structural blocks from
  `ctx.graph`, which is already in scope.
- `artifacts.ts:257` (**the interrupted Pass-A flush**): must also emit
  structural blocks. Otherwise an interrupted run still writes a flowchart-less
  artifact — exactly the bug this plan fixes, in the one path most likely to be
  hit on a large repo. Blocks are cheap and label-independent, so build them
  once before the flush closure and reuse.

**Acceptance check:** the rule covers
**production source only** — `packages/*/src`, excluding `test/` directories,
since fixtures and assertions legitimately construct empty block collections.

```
rg -n 'blockUnits:\s*\[\]' packages/*/src --glob '!**/test/**'
```

Must return only sites carrying an in-line comment justifying them (e.g. the
historical-sha case in §A.4). `grep -rn "blockUnits: \[\]" packages/*/src` is an
equivalent fallback where `rg` is unavailable. Add this to the plan's
verification step so a reintroduced literal is caught.

### A.4 — Historical-sha invariant

`graphFromSnapshot` hardcodes `blockGraph: {}`, but a persisted
`.scv/snapshots/<sha>.json` **may already contain block units** in
`ctx.snapshot.units` (they are written into the snapshot's `units` array by
`orchestrate.ts:1149`). "Writes empty blocks" was ambiguous. The invariant:

> On a `--sha`-sourced merge, `buildBlockUnits` is **not** called (there is no
> `blockGraph` to walk). Block units and `control_flow` edges already present in
> the persisted snapshot are **carried through unchanged**; none are minted,
> relabeled, or dropped.

#### Ownership invariant

Naively partitioning and passing the result as `blockUnits`/`blockEdges` would
**double-emit** every persisted block. Confirmed in `finalizeSnapshot`:

- `orchestrate.ts:1149` — `units: [...finalUnits, ...newUnits, ...blockUnits]`,
  where `finalUnits` is derived from the `units` argument (on a `--sha` path,
  `ctx.snapshot.units`, which already contains the blocks).
- `orchestrate.ts:1097` — `const edges = [...snapshot.edges, ...blockEdges]`,
  and `snapshot.edges` already contains the persisted `control_flow` edges.

So each collection has exactly one owner, and the rule is:

> `blockUnits`/`blockEdges` are the **only** channel for block data into
> `finalizeSnapshot`. The base `units` array and `snapshot.edges` must never also
> carry it. Whichever path supplies blocks removes them from the base.

Two implementations satisfy this; **take the first** — it keeps one code path
for both live and historical merges, so the partition happens in exactly one
place and the invariant is checkable:

1. **Partition and strip (chosen).** When the merge is sourced from a persisted
   snapshot, split `ctx.snapshot.units` into `{ baseUnits, carriedBlockUnits }`
   on `kind === "block"` and `ctx.snapshot.edges` into
   `{ baseEdges, carriedBlockEdges }` on `kind === "control_flow"`. Pass
   `baseUnits`/`baseEdges` as the base and the carried collections as
   `blockUnits`/`blockEdges`. The stripped base is also what
   `functionsData.units` is built from, so the `functions` artifact holds each
   block exactly once too.
2. Rejected: leave blocks in the base and pass `blockUnits: []`. It preserves
   the data but makes the empty literal indistinguishable from the bug this plan
   removes, and defeats the §A.3 grep check.

#### The stripping must reach `finalizeSnapshot`'s `snapshot` argument

Stripping `functionsData.units` alone is **not sufficient**, because
`finalizeSnapshot` reads its two collections from two different places
(`assemble-snapshot.ts:39-52`):

- units come from the `units` **option** → `finalUnits` → deduped by stripping
  `functionsData.units`.
- edges come from the `snapshot` **option** — `orchestrate.ts:1097` is
  `[...snapshot.edges, ...blockEdges]`, and `assemble-snapshot.ts:40` passes
  `snapshot: ctx.snapshot`, unstripped.

So the carried `control_flow` edges would still duplicate. The requirement:

> `assembleSnapshotFromCache` must pass a **`snapshotForAssembly`** — `ctx.snapshot`
> with `units` filtered of `kind === "block"` and `edges` filtered of
> `kind === "control_flow"` — as `finalizeSnapshot`'s `snapshot` argument,
> never `ctx.snapshot` directly. Both filters are unconditional: on a live merge
> they are no-ops (a freshly built `ctx.snapshot` carries no block data), so
> there is one code path, not a historical special case.

Derive `snapshotForAssembly` once in `assemble-snapshot.ts` next to the existing
`ensureArtifact` calls and use it at line 40. `finalizeSnapshot`'s signature is
unchanged — the fix is at the call site, which keeps the interpreter package
unaware of merge-path specifics.

**Assertion, not just a convention:** add a cheap guard at the top of
`finalizeSnapshot` that throws if `snapshot.units` contains a `kind === "block"`
unit or `snapshot.edges` a `kind === "control_flow"` edge while the separate
`blockUnits`/`blockEdges` collections are non-empty. It is the same class of
invariant check as the existing `validateTreeInvariants` call at
`orchestrate.ts:1175`, and it makes a future regression fail loudly at analyze
time rather than silently doubling a snapshot.

Warn once that block labels cannot be updated for a historical sha. This is
strictly better than emitting nothing: an old snapshot's flowcharts keep
rendering.

**Tests** (`packages/interpreter/test/`, `packages/cli/test/merge-semantics.test.ts`):
- **RED for the bug:** after `scv merge-semantics`, the written `functions`
  artifact has non-empty `blockUnits`/`blockEdges` for a fixture function with
  branching.
- `buildBlockUnits` with no labels reproduces exactly what `runFunctionsPass`
  produces today (same ids, names, edge ids, fallback text).
- Passing labels overrides fallback text and sets `edgeLabel` on true/false edges.
- Determinism: two identical calls produce byte-identical output.
- **Label preservation:** seed a cached `functions` artifact with
  labeled blocks, then merge a pending file changing only unit `semantics` →
  block `name`s, `edgeLabel`s, and `provenance` are unchanged, not reset to
  structural text.
- Pending `blockLabels`: unknown `blockId` → warn + skip, sibling labels still
  applied; `trueLabel` on a sequential block → warn + skip those fields only;
  pending label wins over a cached one.
- Interrupted-flush path (`artifacts.ts:257`) writes populated blocks.
- Historical-sha merge carries persisted block units through unchanged (assert
  in both the `functions` artifact and the assembled snapshot) and warns.
- **No duplication on the historical-sha path:** in the assembled
  snapshot, `units.map(u => u.id)` has no duplicates and neither does
  `edges.map(e => e.id)`; the count of `kind === "block"` units and
  `kind === "control_flow"` edges equals the count in the source persisted
  snapshot — not double. Assert the same no-duplicate-id property on the
  `functions` artifact.
- Duplicate-id guard on the **live** path too, so a future change that starts
  leaving blocks in the base is caught by the same assertion.
- **`snapshotForAssembly` stripping:** a historical-`--sha` assembly
  where `ctx.snapshot` holds both block units and `control_flow` edges produces a
  snapshot whose `control_flow` edge count equals the source's — the case that
  fails if only `functionsData.units` is stripped and `snapshot: ctx.snapshot` is
  still passed at `assemble-snapshot.ts:40`.
- The new `finalizeSnapshot` guard throws when handed a `snapshot` still
  containing block units/`control_flow` edges alongside non-empty
  `blockUnits`/`blockEdges`, and does **not** throw on the live path (where the
  filters are no-ops) or when the separate collections are empty.
- **Provenance round-trip:** three separate cases —
  a cached `source: "manual"` label survives a re-merge still `"manual"`;
  a cached `source: "llm"` label keeps its **original** `provider`/`model`
  rather than being re-stamped with the current provider; and a pending label
  overriding a cached LLM label flips provenance to `"manual"`.
- Repeated merges are byte-stable, and the resulting `functions` artifact's
  `inputHash` still matches a follow-up `ensureArtifact("functions", ctx)`, so
  downstream `clusters`/`layers`/`flows` are unaffected.

## Part B — `docs` merge path + skill

Schema (`packages/schema/src/pending-semantics.ts`), alongside existing
`units`/`layers`/`groups`/`flows`:

```ts
docs: z.record(z.string(), PendingDocSchema).default({}),

const PendingDocSchema = z.object({
  path: z.string().min(1),               // must match a discovered doc path
  purpose: z.string(),
  modules: z.array(z.object({
    name: z.string(), description: z.string(), paths: z.array(z.string()).default([]),
  })).default([]),
  architecture_notes: z.array(z.string()).default([]),
});
```

Matches `DocExtract`'s shape exactly (`packages/interpreter/src/pass-docs.ts`).

`mergeDocs(ctx, pendingDocs, warnings)` in `merge-semantics.ts`, following
`mergeGroups`' established shape:
1. Discover real doc paths via the existing `discoverDocs` in
   `packages/cli/src/discover-docs.ts` (reuse — do not re-implement).
2. Per entry: `path` not among discovered docs → warn + skip. Two entries
   claiming the same path → keep first, warn (same skip/warn tone used
   throughout this file).
3. Build `DocExtract[]` from surviving entries.
4. Write via `computeInputHash("docs", ctx, {})` — matching the `docs` case in
   `computeInputHash` so a later `scv analyze` sees a fresh match.

Add `--with-docs` to `MergeSemanticsOptions`, `RunMergeSemanticsOptions`, and
the `merge-semantics` command in `packages/cli/src/bin.ts`.

**Replacement semantics — union, not replace.** A pending file may
legitimately cover only some docs (an agent narrating a large repo folder by
folder, mirroring the `agent-analyze-functions` split guidance). Building
`DocExtract[]` from the pending entries alone would silently delete previously
merged narrations. The contract, matching `mergeLayerClustering`'s existing
precedent at `merge-semantics.ts:401-431` ("must keep whatever
name/narration/provenance it already has in the cached" entry):

> `mergeDocs` **unions** pending entries over the cached `docs` artifact, keyed
> by `path`. A pending entry replaces the cached entry for that path outright
> (per-doc, not per-field). A cached entry whose path is absent from the pending
> file is **preserved unchanged**. Nothing is deleted by omission.

Consequences to implement:
- An entry rejected as unknown-path or duplicate leaves any cached entry for
  that path **intact** — a bad pending row must not destroy good cached data.
- Removing a doc narration is therefore not expressible through a merge; it
  happens via `scv analyze docs --force`. State this in the skill doc.
- A doc file that has since disappeared from `discoverDocs` is dropped from the
  union (it is no longer part of the repo) and warned about.
- **Stable ordering:** emit the union sorted by `path`, so the artifact is
  byte-identical regardless of pending-entry order or merge count — required for
  the `inputHash` determinism the plan already depends on.

**Merge ordering.** `mergeSemantics` runs its sub-merges in a fixed
sequence: `if (withClustering)` at `merge-semantics.ts:333`, `if (withGroups)`
at `:339`, `if (withFlows)` at `:345`. Because `runClustersPass` consumes
`deps.docs`, **`mergeDocs` must be inserted before line 333** — otherwise a
single `--with-docs --with-clustering` invocation clusters over `[]` docs and
then writes a `clusters` artifact whose `inputHash` locks that bad result in.
The intended order is: units → docs → clustering → groups → flows. Add
`NO_PROVIDER` coverage for `"docs"` alongside the existing entries at `:535`.

**Test for it:** a single CLI invocation with `--with-docs --with-clustering`
must produce a `clusters` artifact identical to running `--with-docs` first and
`--with-clustering` second — proving docs were visible to clustering.

`.agents/skills/agent-analyze-docs/SKILL.md`, modeled on the existing four:
run `scv analyze <root> --no-llm`, read the repo's README/`docs/` files, author
one entry per doc, write `.scv/pending/<sha>/semantics-docs.json`, run
`scv merge-semantics <file> [root] --with-docs`. State the filename is a
convention the CLI does not enforce (as the other skill docs do), and that an
unknown `path` is skipped with a warning.

**No provider-call escape hatch.** Bare `scv analyze <root> docs`
must not appear in the skill: without `--no-llm` it computes the real Docs
artifact and calls the configured provider, contradicting the zero-provider
guarantee the umbrella chain rests on. To see the discovered doc paths, the
skill inspects `.scv/artifacts/<sha>/docs.json` (or re-runs
`scv analyze <root> --no-llm`, which defaults the artifact rather than computing
it) — never a bare stage invocation. Apply the same rule to every skill in the
suite, **with no exemptions**: any `scv analyze` in an
`agent-analyze-*` doc carries `--no-llm`, and Part D's final verification step is
the only place a bare `scv analyze` appears — deliberately, to prove
`usage: calls=0`.

A deterministic *stage* is not a zero-call *command*: `ensureArtifact` freshens
dependencies recursively, so `clusters` can reach the provider through
`functions`/`docs`. The earlier exemption for `clusters` is withdrawn — see the
enforced precondition in Part C.

The skill doc must also state that a merge **adds to** existing docs narration
and cannot remove one (per the union contract above) — `scv analyze docs --force`
is the way to start over, and that command *does* call the provider.

**Tests**: happy path merges and `docs.json` inputHash matches a follow-up
`ensureArtifact("docs", ctx)`; unknown path → warn + skip, other entries still
merge; duplicate path → second skipped; inputHash determinism on re-run.

Union-contract tests:
- **Partial merge preserves cached entries:** merge docs A+B, then merge a
  pending file containing only C → the artifact holds A, B, and C. This is the
  RED test for the silent-deletion bug.
- **Re-merging a path replaces that entry only:** merging a new B leaves A
  untouched and B fully overwritten (no field-level blending).
- **A rejected entry does not destroy cached data:** with A cached, a pending
  file whose only entry is an unknown path leaves A intact and warns.
- **A vanished doc file is dropped and warned**, while surviving entries remain.
- **Stale-cache round trip:** cache docs for A and B, delete B's
  file from the repo, re-run `mergeDocs` → B is dropped, a warning names it, the
  output is still `path`-sorted, and — the part the earlier hash test did not
  establish — the written `inputHash` matches a follow-up
  `ensureArtifact("docs", ctx)` against the *current* discovered-doc set, so the
  post-drop artifact is reused rather than recomputed. Guards against the drop
  and the hash disagreeing about what the repo contains.
- **Stable ordering:** the same set of docs merged in different orders, and
  across repeated merges, yields a byte-identical `docs.json`.

## Part C — Two thin deterministic skills

No new CLI code — these run existing commands and report.

`.agents/skills/agent-analyze-structure/SKILL.md`
- Runs `scv analyze <root> --no-llm` (extraction + deterministic blocks after
  Part A).
- Reports unit count and file count, and a **conditional** block report — zero
  blocks is a legitimate outcome, so the skill must not claim the Flowchart view
  works without checking. Report against the actual counts:
  - `blockUnits > 0` → blocks populated; the Flowchart view works for the
    functions that have them. Report the count and how many functions are
    covered.
  - `blockUnits === 0` **and** the extraction artifact shows no branching block
    entries → *"no branching functions in this repo"*. Expected, not a failure;
    the Flowchart view will legitimately be empty.
  - `blockUnits === 0` **while** the extraction artifact does show branching
    entries → **a failed block build**. This is the regression this plan fixes;
    say so loudly and do not proceed with the chain.
  - Historical `--sha` source → *"blocks cannot be rebuilt for a historical
    sha"* (§A.4), distinct from both cases above. The source is checked first;
    an extraction artifact that *exists* with an empty `blockGraph` is the
    no-branching case, never this one.
  - Live source with **no extraction artifact** → *"run `scv analyze <root>
    --no-llm` first"* — an actionable setup failure, not a historical case
   . Halt the chain; this is step 1's own precondition.

**Where the branching signal comes from.** `blockGraph` is **not**
persisted in the snapshot — it appears nowhere in `packages/schema/src`, so the
snapshot alone cannot distinguish "no branching" from "failed build". The
authority is the **`extraction` artifact**: `computeArtifact`'s
`case "extraction"` returns `ctx.graph` verbatim (`artifacts.ts:247-248`), which
carries `blockGraph`, and it is written to `.scv/artifacts/<sha>/extraction.json`.
It is also never provider-backed — `artifacts.ts:551` treats `"extraction"` as
always computable — so reading it costs nothing and cannot trigger an LLM call.

The skill therefore classifies from **two** sources:
- `.scv/artifacts/<sha>/extraction.json` → `blockGraph`, for whether branching
  functions exist at all. Count functions whose entry has more than one block
  or any non-`sequential` block.
- `.scv/snapshots/<sha>.json` → the resulting `kind === "block"` unit count.

**Historical-`--sha` signal:** the source is **declared, not
inferred**. Replacing an artifact-*shape* inference with an
artifact-*presence* inference is still an inference and still wrong:
`extraction.json` is equally absent when a live analysis has never
run, was interrupted before extraction persisted, or had its cache cleared.

The signal is **whether the invocation named a historical sha** — a fact the
caller holds directly, never read back off disk.

`merge-semantics.ts` already models exactly this: `fromPersistedSnapshot`
(`:70`) is set at `:264` from `persisted !== undefined` and passed positionally
to `mergeFlows` (`:346`) for this same class of decision. The structure skill
follows that precedent, but note it is a **precedent, not a shared variable** —
the two live on different commands:

- **`scv merge-semantics --sha`** → `fromPersistedSnapshot`, already implemented.
  This is §A.4's trigger.
- **`agent-analyze-structure`**, which runs `scv analyze`, not
  `merge-semantics` → the skill knows the source because it either passed a
  historical sha or it did not, and supplies `source` to the classifier
  accordingly.

So `classifyBlockAvailability` is a **pure function taking `source` as a
parameter**. It does not read `ArtifactContext`, and nothing needs to be threaded
through `ensureArtifact` — `ArtifactContext` (`artifacts.ts:115`) carries a
`sha` but no live/historical flag, and this design deliberately does not add one.
The two paths key on the same *declared fact* rather than on two conditions that
happen to agree; they do not share a field.

Given the source, artifact state means different things:

| source | extraction.json | meaning |
|---|---|---|
| `historical` | absent | `"historical-unavailable"` — expected; blocks cannot be rebuilt |
| `live` | absent | `"missing-input"` — **actionable setup failure**: analysis never ran, was interrupted, or the cache was cleared. Tell the user to run `scv analyze <root> --no-llm` |
| `live` | present, empty `blockGraph` | `"no-branching"` — a real repo with no branching functions |
| `live` | present, has branching | `"populated"` or `"failed-build"`, on block count |

An empty `blockGraph` is never on its own evidence of a historical source, and
neither is a missing artifact.

- Points the agent at `.scv/snapshots/<sha>.json` for the real unit ids every
  other skill needs, and at `.scv/artifacts/<sha>/extraction.json` for
  `blockGraph` and the real per-function `blockId`s §A.2 requires.
- This is the mandatory first step of the chain — states so explicitly.

`.agents/skills/agent-analyze-clusters/SKILL.md`
- Runs `scv analyze <root> clusters --no-llm` (see the enforced precondition
  below — the bare form is **not** exempt from the suite-wide rule).
- **Before running, verifies `functions` and `docs` artifacts are narrated**,
  not defaulted — clustering is deterministic but consumes both, so clustering
  over un-narrated inputs produces poor groupings. Warn clearly if either is
  missing/empty and recommend running `agent-analyze-functions` and
  `agent-analyze-docs` first.

**The docs check cannot key on emptiness alone.** `docs.json.data
=== []` is ambiguous in exactly the way `blockGraph: {}` is:
`runDocsPass` runs over `ctx.docs`, the *discovered* set (`artifacts.ts:284-293`),
so a faithful narration of a repo with no docs and a `--no-llm` default both
produce `[]` with `partial: false`. `DocExtract` (`pass-docs.ts:23-28`) has **no
provenance field**, so the artifact cannot answer the question about itself.

Disambiguate with the **discovered-doc count** from `discoverDocs`
(`packages/cli/src/discover-docs.ts`), which the docs merge path already reuses
(Part B):

| discovered | `docs.json` | meaning | chain |
|---|---|---|---|
| 0 | `[]` | repo genuinely has no docs | **continue**; note clustering runs on function semantics alone |
| > 0 | absent | docs stage never ran | **halt**; run `agent-analyze-docs` |
| > 0 | `[]` | discovered docs were dropped — a `--no-llm` default or a failed merge | **halt**; run `agent-analyze-docs` |
| > 0 | `n` entries, `n < discovered` | partially narrated | **warn, continue**; name the missing paths |

Zero discovered docs is a legitimate repo shape, not a failure — the chain
continues with an explicit note rather than a warning, since there is no action
the user could take. Every other shortfall names the specific paths so the fix is
mechanical.

Provenance is deliberately **not** added to `DocExtract` for this: it would be a
schema change to a persisted artifact, and the discovered-count comparison
answers the question without one.

**Tests** (`packages/cli/test/`): zero discovered docs + `[]` → "narrated,
continue", no warning; discovered docs + `[]` → "not narrated, halt" (the
defaulted case); discovered docs + absent artifact → halt; partial coverage →
warn naming the missing paths, continue.

#### The clusters precondition must be enforced in code, not prose

Exempting `clusters` from the suite-wide `--no-llm` rule — on the grounds that
Pass B is deterministic — is wrong, and the reasoning is worth stating because it
is tempting. `clusters` is deterministic *itself*, but `ensureArtifact` "freshens
`name`'s dependencies first (recursively)" (`artifacts.ts:449-453`), and an
absent `allowProvider` means **every** artifact may call the provider
(`:422-424`). So a bare `scv analyze <root> clusters` over stale, partial, or
absent `functions`/`docs` calls the provider on those dependencies before Pass B
ever runs — breaking the umbrella chain's zero-call guarantee. A "verify first"
instruction in a SKILL.md cannot enforce this; only the CLI can.

The mechanism is `allowProvider`, `dependencyClosure` (`:438`), and
`EnsuredArtifact.defaultedArtifacts` (`:428-434`) — but **an empty
`allowProvider` is the wrong set**. `mayCallProvider` at `:551`
gates the *requested* artifact as well as its dependencies, so an empty set
sends `clusters` itself down the `noLlmFallback` path at `:555`: no Pass B run,
an empty default written, and the precondition never exercised.

The distinction the option needs is **deterministic target vs. provider-backed
dependency**, and `artifacts.ts:551` already encodes exactly that idea for one
stage — `name === "extraction"` is special-cased as always computable with the
comment "never calls a provider to begin with". `clusters` has the same property
(`pass-b.ts:19`, "no longer an LLM pass (plan 4c)"; `runClustersPass` takes no
provider) but is not in the special case. Generalize instead of hardcoding a
second name:

```ts
/** Stages whose own pass never calls a provider. They are always computed for real,
 *  regardless of `allowProvider`, which gates only provider-backed stages.
 *  Their provider-backed *dependencies* are still subject to it. */
const DETERMINISTIC_ARTIFACTS: ReadonlySet<ArtifactName> = new Set(["extraction", "clusters"]);
```

`:551` becomes `DETERMINISTIC_ARTIFACTS.has(name) || !opts?.allowProvider || opts.allowProvider.has(name)`,
which is behaviour-preserving for `extraction` and correct for `clusters`.

Then the two changes:

1. **`--no-llm` passes an empty `allowProvider`** — `new Set()`. This is the
   single definition of the set for this flag; see the note below on why it is
   empty rather than a computed subset. Every provider-backed stage
   (`functions`, `docs`, …) empty-defaults instead of calling out, while
   `clusters` and `extraction` still compute for real via
   `DETERMINISTIC_ARTIFACTS`. Pass B runs; no provider is reachable.
2. **Fail loudly instead of silently clustering over defaults.** If any
   dependency was empty-defaulted, fail the run naming each defaulted artifact
   and the skill that produces it — see the failure contract below for how that
   reaches a non-zero exit code. Silently clustering over empty
   inputs is the poor-groupings outcome the skill's prose check was meant to
   prevent but could not enforce,
   and `defaultedArtifacts` reports it precisely: a dependency resolved from a
   real fresh cache entry is never in the set "even if its own payload happens to
   be empty" (`:430-433`) — so this composes with the zero-docs
   ambiguity noted in Part C rather than contradicting it.

**The check must run before the target is written, not after.** Computing
`clusters` first and only then inspecting `defaultedArtifacts` would leave a
**fresh, cache-valid `clusters.json` derived from empty defaults** on disk after
a failed command — the exact poor-groupings artifact the precondition exists to
prevent, now indistinguishable from a good one and silently reused by the next
`scv analyze`. A failed run must leave no usable clusters artifact.

This needs no rollback or post-hoc invalidation, because `ensureArtifact` already
resolves every dependency before computing the target: the recursion at
`artifacts.ts:536-541` fully populates `defaultedArtifacts` from the dependency
results, and `computeArtifact`/`writeArtifact` do not run until `:558-559`.
Enforce the precondition in that window — after the dependency loop, before the
`fresh`/`mayCallProvider` decision for `name` — via an opt-in
`EnsureArtifactOptions` field so only the targeted `--no-llm` path is affected:

```ts
/** Fail instead of computing `name` if any dependency was empty-defaulted.
 *  Set only on the targeted `--no-llm` path; absent everywhere else. */
requireFreshDependencies?: boolean;
```

Nothing is written, so there is nothing to undo, and a corrected run afterwards
computes `clusters` normally from the now-fresh dependencies.

The zero-call guarantee remains independent of this check — it comes from the
`allowProvider` set. This ordering rule is about cache integrity on failure.

The skill's pre-flight check stays as a *diagnostic* that gives a better message
earlier, but it is no longer the guarantee. The guarantee is that the command
cannot reach a provider.

#### `--no-llm` must stop bypassing the target

The two changes above are inert until `runAnalyze` routes a targeted `--no-llm`
run through `ensureArtifact` at all. Today `options.noLlm` short-circuits at
`analyze.ts:154-158` straight into `assembleSnapshotFromCache`, which ensures a
**fixed four** — `functions`, `layers`, `groups`, `flows`
(`assemble-snapshot.ts:31-34`) — and never the requested target. `clusters` is
reached only incidentally, as a transitive dependency of `layers`. So
`scv analyze <root> clusters --no-llm` cannot run Pass B, cannot write a fresh
`clusters.json`, and cannot surface the `defaultedArtifacts` the precondition
reads. `options.artifact` is simply ignored on this path.

The non-`--no-llm` branch already has the right shape (`:160-179`): compute
`allowProvider` from `dependencyClosure(options.artifact)`, ensure the target,
collect `defaultedArtifacts`, then assemble. The fix is to stop treating
`--no-llm` as a *different pipeline* and treat it as a *narrower
`allowProvider`*:

- **Untargeted `--no-llm`** — unchanged. Keep today's
  `assembleSnapshotFromCache` behaviour exactly; this is the common path and no
  finding touches it.
- **Targeted `--no-llm`** (`options.artifact` set) — take the `:160-179` branch
  with `allowProvider = new Set()`. Deterministic targets compute for real via
  `DETERMINISTIC_ARTIFACTS`; every provider-backed stage empty-defaults instead
  of calling out. Then apply the clusters precondition to the returned
  `defaultedArtifacts`, and assemble the snapshot from the resulting cache.

  **Why empty and not a computed subset.** `allowProvider` is an *allow-list*
  (`artifacts.ts:422-425`), consulted at `:551` as `opts.allowProvider.has(name)`.
  So `dependencyClosure("clusters") \ DETERMINISTIC_ARTIFACTS` is
  `{functions, docs}` — passing that would **permit exactly the two provider
  calls `--no-llm` exists to block**. Under this flag the allow-list is empty,
  full stop; the target still runs because it is exempt from the gate, not
  because it is named in the set. Do not "correct" this to the provider-backed
  closure — that reading was proposed twice during review and is wrong in the
  dangerous direction, since it silently re-enables the calls.

This keeps one code path for "ensure a target under a provider budget" and makes
`--no-llm` mean what its name says — *no provider calls* — rather than *skip the
pipeline*. It also removes the asymmetry where `--no-llm` silently discards
`options.artifact`, which is the root cause of this finding.

#### The failure contract for a defaulted target

"Exit non-zero" has no mechanism today. `runAnalyze` returns `RunAnalyzeResult`
(`analyze.ts:47-54`), and `bin.ts:54-58` treats a non-empty `emptyArtifacts` as a
`[WARN]` on stderr while still exiting **0**. The precondition needs a stronger
signal than that warning, and must not weaken it for the paths that legitimately
warn.

**Mechanism: `runAnalyze` throws a typed error; the CLI already converts it.**

```ts
export class DefaultedArtifactsError extends Error {
  readonly defaultedArtifacts: ArtifactName[];
}
```

Thrown from inside `ensureArtifact` under `requireFreshDependencies` — after the
dependency loop, before the target is computed or written — and only on the
**targeted `--no-llm`** path. Throwing there rather than back in `runAnalyze` is
what makes the failure leave no artifact behind; `runAnalyze` lets it propagate.
Chosen over a result status field because `bin.ts:128-130`
(`program.parseAsync(...).catch(...)` → `process.exitCode = 1`) already turns a
throw into a non-zero exit with the message on stderr, so no new branch is needed
in the command action, and because a status field a caller may ignore is exactly
the silent-degradation shape this finding is about.

The message names every defaulted artifact and the skill that produces it, and
`defaultedArtifacts` is preserved on the error so a library caller can act on the
names without parsing prose.

**Cache lifetime.** No change required: `cache.close()` is already in a `finally`
(`analyze.ts:202-203`), so it runs before the error propagates. Throw from inside
that `try`, not after it — a throw placed after the `finally` block would leak the
handle.

**Unchanged elsewhere.** Every other path keeps returning `emptyArtifacts` and
exiting 0 with the existing `[WARN]`. An untargeted `--no-llm` run merging
without narration is a normal, expected state; only a *targeted* deterministic
stage silently computing over empty inputs is the error.

#### `--no-llm`'s documented contract changes too

`--no-llm` currently means one thing everywhere: *merge from cache only, empty
defaults for anything not fresh*. After this change it means two things depending
on whether a target was named, and three places state the old contract verbatim:

| Site | Says today | Must say |
|---|---|---|
| `analyze.ts:39-41` — `RunAnalyzeOptions.noLlm` doc comment | "Merge from cache only — never call a provider; artifacts with no fresh cache entry are assembled from their empty default instead of being computed." | Keep the never-calls-a-provider guarantee as the headline, then split: **untargeted** behaves exactly as described today; **targeted** (`artifact` set) ensures that artifact, so a deterministic target (`DETERMINISTIC_ARTIFACTS`) is really computed while provider-backed artifacts still empty-default — and a defaulted dependency now throws `DefaultedArtifactsError` rather than warning. |
| `analyze.ts:70-72` — `runAnalyze` header block | "`noLlm` still runs this full merge/finalize path — it never calls a provider, though: every artifact with no fresh cache entry is assembled from its declared empty default" | Same split. "Every artifact … empty default" becomes false for a deterministic target, which is precisely the bug this plan fixes; keep the sentence's real point (the merge/finalize path still runs) and correct the exception. |
| `bin.ts:24` — `--no-llm` help text | "merge from cache only — never call a provider; artifacts with no cache use an empty default" | One line, user-facing, so state the guarantee and the exception without the internals: never calls a provider; without `[artifact]` merges from cache with empty defaults; with `[artifact]` also computes that stage if it is deterministic. |

The invariant that must survive all three rewrites, and the reason this is worth
spelling out: **`--no-llm` never reaches a provider** — that is unchanged and is
the property users rely on. What changes is only whether a *deterministic* stage
is computed or defaulted. Do not let a rewrite blur the guarantee into "avoids
the LLM where it can", which is a weaker claim than the empty `allowProvider`
actually delivers.

Also update the `agent-analyze-clusters` skill text (Part C) to match, since it
is the one caller that depends on the new targeted behaviour.

**Tests.** All use a provider that **throws on any call**, so a zero-call claim
is enforced rather than asserted:
- Stale/absent `functions`/`docs`, targeted `clusters --no-llm` → provider never
  invoked; `runAnalyze` rejects with `DefaultedArtifactsError` whose
  `defaultedArtifacts` is `["functions", "docs"]`.
- **A failed run leaves no usable clusters artifact.** After that rejection,
  assert `clusters.json` is either absent or unchanged from its pre-run state —
  specifically that no entry exists whose `inputHash` matches the failed run's
  inputs, since such an entry would read as fresh and be reused silently. Then
  narrate `functions`/`docs`, re-run the same command, and assert it now exits
  `0` with a real Pass B result — proving the failure left the cache in a state a
  corrected run recovers from cleanly.
- **The exit code itself**, asserted at the CLI layer rather than inferred from
  the library: spawn `scv analyze <fixture> clusters --no-llm` on that same
  stale-cache state and assert exit code `1` and the defaulted names on stderr.
  The library test alone cannot catch a regression in `bin.ts`'s error handling,
  which is where the exit code is actually decided.
- A *warning* path (untargeted `--no-llm` with missing narration) still exits
  `0` — guards against the typed error being thrown too broadly.
- **Green case:** fresh narrated dependencies → provider never
  invoked, `defaultedArtifacts` empty, and **`clusters.json` is freshly computed
  with a real Pass B result** — assert non-empty clusters and a matching
  `inputHash`, *not* merely a successful exit. An empty default would also exit
  zero, so this assertion is the one that distinguishes a real Pass B run from an
  empty default — the failure mode `DETERMINISTIC_ARTIFACTS` exists to prevent.
- **Deterministic-target regression:** `ensureArtifact("clusters", ctx, { allowProvider: new Set() })`
  computes rather than defaults, while
  `ensureArtifact("docs", ctx, { allowProvider: new Set() })` still defaults —
  pinning the `DETERMINISTIC_ARTIFACTS` distinction directly.
- `extraction` behaviour is unchanged by the generalization (existing tests must
  stay green).
- **End-to-end CLI test:** invoke `scv analyze <root> clusters
  --no-llm` through `runAnalyze` — not `ensureArtifact` directly — and assert a
  real `clusters.json` is written and the provider is never invoked. A unit test
  on `ensureArtifact` alone would pass while the command still bypassed it,
  which is exactly how #21 survived rounds 19 and 20.
- **Exact-set assertion:** spy on `ensureArtifact` and assert
  `runAnalyze` passes `allowProvider` **equal to the empty set** for a targeted
  `--no-llm` run — not merely that the call count was zero. A wrong-but-larger
  set (e.g. `{functions, docs}`) yields zero calls whenever those artifacts
  happen to be fresh, so the call-count assertion alone cannot distinguish the
  correct set from the bug this round found. Pair it with the same assertion for
  a targeted run *without* `--no-llm`, which must still pass
  `dependencyClosure(options.artifact)`.
- **Untargeted `--no-llm` is unregressed:** `scv analyze <root> --no-llm` still
  assembles from cache with the same artifacts and warnings as today.

Back in the clusters skill doc, it also:
- Reports resulting cluster count and `modularity`/`directoryModularity`, and
  points at `.scv/artifacts/<sha>/clusters.json` for the real `files` sets that
  `agent-analyze-layers` must match exactly.
- States plainly that there is nothing to author here — Pass B is deterministic
  (`pass-b.ts:19`); layer *names and narration* are `agent-analyze-layers`.

**Tests for the structure skill's classification.** The
report is real logic, so extract it as a small exported helper in the CLI
package and test it directly rather than leaving it as prose in a SKILL.md. Both
the **source** and the **artifact's presence** are explicit inputs; neither is
inferred from the other or from `blockGraph`'s contents:

```ts
export type BlockAvailability =
  | "populated" | "no-branching" | "failed-build"
  | "historical-unavailable" | "missing-input";

export function classifyBlockAvailability(input: {
  blockUnitCount: number;
  /** Declared by the invocation, never inferred from disk. */
  source: "live" | "historical";
  /** null when .scv/artifacts/<sha>/extraction.json does not exist. On a live
   *  source that is a setup failure, not a historical case. */
  extraction: { blockGraph: BlockGraph } | null;
}): BlockAvailability;
```

Order of evaluation: `source === "historical"` → `"historical-unavailable"`,
before `extraction` is consulted. Then `extraction === null` on a live source →
`"missing-input"`, before `blockGraph` is read. Only then does block-count and
branching classification run.

Tests:
- Branching repo, blocks built → `"populated"`.
- Repo with no branching functions (empty/all-sequential `blockGraph`), zero
  blocks → `"no-branching"`, **not** an error.
- **Branching repo whose snapshot has zero block units while `extraction.json`
  proves branching exists → `"failed-build"`.** This is the case the reviewer
  called out and the one that must not be silently reported as success; it is
  also a second RED test for the original bug.
- Historical source, extraction absent → `"historical-unavailable"`, never
  `"failed-build"`, even when function units are present.
- **Live source, extraction absent → `"missing-input"`**, never
  `"historical-unavailable"`. The skill reports it as an actionable setup
  failure and halts the chain.
- Historical source with an extraction artifact somehow present → still
  `"historical-unavailable"`; the declared source wins, since
  `graphFromSnapshot` supplies no `blockGraph` regardless of what is on disk.
- **Regression triple for reviews #16 and #17:** identical `blockUnitCount: 0`
  classifies as `"no-branching"` (live, empty `blockGraph`), `"missing-input"`
  (live, `extraction: null`), and `"historical-unavailable"` (historical) —
  asserted together in one test so the three cannot collapse into each other
  again.

## Part D — `agent-analyze-repo` umbrella skill

`.agents/skills/agent-analyze-repo/SKILL.md` — orchestrates the full chain in
dependency order, producing a complete snapshot with zero provider calls:

```
1. agent-analyze-structure    → extraction + blocks (deterministic)
2. agent-analyze-functions    → functions   (authored; optional block labels)
3. agent-analyze-docs         → docs        (authored)
4. agent-analyze-clusters     → clusters    (deterministic pass, but --no-llm
                                             required: deps 2 + 3 are enforced,
                                             not assumed)
5. agent-analyze-layers       → layers      (authored, --with-clustering)
6. agent-analyze-groups       → groups      (authored, --with-groups; needs fresh layers)
7. agent-analyze-flows        → flows       (authored, --with-flows; live extraction only)
```

Must state:
- Each step's merge writes an artifact whose `inputHash` a later `scv analyze`
  matches, so nothing recomputes.
- Steps 2 and 3 are independent of each other and may be authored in either
  order, but both must precede step 4.
- Step 7 does not support `--sha` (no persisted DI/block-graph data) — carried
  forward from `agent-analyze-flows`.
- Parallelization guidance for step 2 on large repos: split by folder, per the
  existing `agent-analyze-functions` doc.
- Finish with `scv analyze <root>` to confirm `usage: calls=0`, then `scv ui`.

Keep it short: the chain, the dependency rules, the failure modes. Per-stage
authoring detail belongs in each stage's own skill, not duplicated here.

## Part E — Docs

- `CLAUDE.md` skills table: add `agent-analyze-structure`, `-docs`, `-clusters`,
  `-repo` rows.
- `docs/plans/README.md`: add this plan.
- **`--no-llm`'s in-code contract** — `analyze.ts:39-41`, `analyze.ts:70-72`, and
  `bin.ts:24`, per the table in Part C. These are behaviour
  documentation for a contract this plan changes, not optional polish; land them
  in the same commit as the targeted-`--no-llm` routing.
- `docs/spec/roadmap.md`: the "Known open issues" ollama entry is **stale** —
  resumable Pass A + `--scope` (PRs #149/#151) closed it. Remove it and note the
  agent-analyze suite under the pipeline section.

## Implementation order

Authoritative sequence (adopted from the reviewer's execution-sequence note, so
it lives in the plan body rather than inside a review section):

1. Add the RED CLI regression for populated blocks after `merge-semantics`, plus
   direct `buildBlockUnits` tests.
2. Implement `buildBlockUnits`, pending block labels (§A.2), cache
   recovery/provenance (§A.1), and the six empty-block-site fixes (§A.3). Run
   focused interpreter/CLI tests.
3. Implement historical snapshot ownership/stripping through `finalizeSnapshot`
   (§A.4); add the no-duplicate unit/edge and provenance regression tests.
4. Add the docs schema/merge and `--with-docs` (Part B); implement union,
   stale-file, ordering, and input-hash tests. Docs merge must precede
   clustering.
5. Add `classifyBlockAvailability` with the explicit live/historical source
   input. Introduce `DETERMINISTIC_ARTIFACTS` and generalize
   `artifacts.ts:551`, then enforce the fresh/non-defaulted
   `functions`/`docs` precondition (`requireFreshDependencies`) inside
   `ensureArtifact` after the dependency loop and **before the target is computed
   or written**, so no provider call can occur indirectly and a failed run leaves
   no clusters artifact — with the green-case assertion that clusters is really
   computed, not empty-defaulted. Route targeted `--no-llm`
   runs through the `ensureArtifact` branch in `runAnalyze` instead of the
   assemble-only short-circuit, leaving the untargeted path unchanged, and
   cover it with a `runAnalyze`-level CLI test.
6. Add the four skills and the umbrella chain (Parts C, D); update `CLAUDE.md`,
   `docs/plans/README.md`, and the roadmap (Part E).
7. Run `npm test`, `npm run lint`, `npm run build`; then the full
   `fixtures/orderly` chain and UI regression checks below.
8. Run a fresh `project-review`, then branch / verify / push / open the PR per
   the repository workflow.

## Verification

1. **TDD RED-GREEN** per project convention — the Part A merge test (non-empty
   `blockUnits` after merge) must fail first.
2. `npm test`, `npm run lint`, `npm run build` clean, plus the §A.3 acceptance
   check (`rg -n 'blockUnits:\s*\[\]' packages/*/src --glob '!**/test/**'`
   returns only commented, justified sites).
3. End-to-end on `fixtures/orderly`, exercising the umbrella chain by hand **in
   Part D's dependency order** — clusters must be fresh *before* layers, because
   layers merge with `--with-clustering`; groups need fresh layers; flows follow
   groups:
   1. `scv analyze fixtures/orderly --no-llm` (structure/extraction + blocks)
   2. author + merge **functions** and **docs** — independent of each other,
      either order, both before clusters
   3. `scv analyze fixtures/orderly clusters --no-llm` → confirm exit `0` and a
      freshly computed `clusters.json` (non-empty clusters, matching
      `inputHash`): the clusters precondition passing, not firing
   4. author + merge **layers** (`--with-clustering`), then **groups**
      (`--with-groups`), then **flows** (`--with-flows`)
   5. `scv analyze fixtures/orderly` → confirm `usage: calls=0` in the progress
      log (no provider call anywhere)

   Keep the **stale-dependency negative test separate from this green chain** —
   running it inline would leave the fixture's cache in the failed state the rest
   of the walkthrough depends on being clean. On a scratch copy of the fixture,
   invalidate the `functions` artifact, run
   `scv analyze <copy> clusters --no-llm`, and confirm exit `1` naming the
   defaulted artifacts. See the note below on where the throwing-provider
   assertion actually lives.
   - `scv ui` → confirm via Playwright: layers/groups/flows render with
     narration, **and double-clicking a branching function opens a populated
     Flowchart view showing agent-authored block labels and yes/no edge
     labels** (the regression this plan fixes). Confirm Current /
     Delta / Depends-on views are unaffected.
**Where the throwing-provider assertion lives.** It is a
**`runAnalyze`-layer test, not a shell step.** `scv --provider` accepts only
`ollama | anthropic | claude-cli` (`bin.ts:20`), so no throwing provider is
reachable from the binary. The seam is `analyze.ts:101` —
`options.provider ?? createProvider(loadInterpreterConfig(scvDir))` — which lets
a test inject one directly; that is the layer every zero-call assertion in Part C
already targets, and it *enforces* the claim rather than reading it off a log.

The `fixtures/orderly` walkthrough therefore verifies the same property by its
observable proxy: `--no-llm` throughout, then `usage: calls=0` on the final bare
`scv analyze`. Do not add a test-only provider name to the CLI for this — it
would widen a user-facing surface to serve a test that already has a seam.

4. Git workflow: branch `feature/agent-analyze-suite`, implement, verify,
   `project-review` skill, post verdict to the PR, push, PR.

## Out of scope

- The automated **group-narration pass** and sticky group names
  (`docs/backlog/group-narration-pass.md`) — the agent-authored `--with-groups`
  path stays the zero-cost escape hatch; the real LLM pass is separate work.
- Persisting `via`/`blockGraph` into the snapshot format to lift the `--sha`
  limits on flows and blocks — a schema change, tracked separately.


## Design notes worth keeping

Fourteen review rounds shaped the plan above; the body is the only
specification. These few notes are kept because each records a conclusion that
is *tempting to reverse* during implementation, and reversing it silently
reintroduces a bug the plan already fixed.

**`allowProvider` is an allow-list.** Under `--no-llm` it is `new Set()` — full
stop. Do not "correct" this to `dependencyClosure(target) \
DETERMINISTIC_ARTIFACTS`; that set is `{functions, docs}`, which would *permit*
exactly the two provider calls the flag exists to block. A deterministic target
computes because it is exempt from the gate (`DETERMINISTIC_ARTIFACTS`), never
because it is named in the set.

**Never infer a fact about the run from the state of an artifact.** An artifact
cannot answer "was I defaulted, or am I genuinely empty?" — `blockGraph: {}` and
`docs.data === []` each have two legitimate causes. Every such question takes a
declared input (`fromPersistedSnapshot`) or an independent source of truth (the
discovered-doc count). This is why `classifyBlockAvailability` takes `source` as
a parameter rather than sniffing the cache.

**Test at the layer the user actually invokes.** Unit tests on `ensureArtifact`
pass green while the CLI bypasses it entirely — which is exactly what
`--no-llm` did. Assert the exit code by spawning the CLI, and assert the
`allowProvider` *set*, not the zero-call effect it usually produces: a
wrong-but-larger set still yields zero calls whenever the named artifacts happen
to be fresh, which is the common case in a fixture test.

**`rg` is not mandated by this repo.** The only required commands are
`npm run dev | test | lint`. The §A.3 acceptance search uses `rg` on its merits,
with a documented `grep` fallback.

## Status

**Not started.** All review findings are resolved in the plan body; no
implementation has begun. Tracked as **Not started** in `docs/plans/README.md`.

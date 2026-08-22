# Phase 4c — deterministic partition

Executes Phase 4c of `hierarchy-correctness-and-clustering-redesign.md`. Self-contained: the
membership algorithm is specified in full under Design, superseding the earlier standalone
`deterministic-clustering-algorithm.md` (removed — its step 6 was disproved, see below).

**Status: not started.** Phases 4a (`clusteringQuality`) and 4b (adversarial fixture) are complete
on `feature/clustering-quality`.

## Context

Pass B's clustering cannot express the answer. `applyDirectoryMerges`
(`packages/interpreter/src/pass-b.ts:40-87`) operates on **directory buckets, not files**: the
LLM proposes which whole directories to union, and unlisted directories stay as singletons. So no
LLM response can ever *split* a directory. That is exactly the 4b adversarial fixture's `scripts/`
trap — `scripts/billing_backfill.py` belongs with billing, `scripts/rotate_logs.py` with ops, and
the current contract cannot separate them at any temperature.

Membership is also provider-dependent: re-running against a different model reshuffles layers, so
layer ids churn and every skin renders a different map from the same code.

4c replaces the merges-over-directories contract with deterministic weighted agglomerative
clustering over the file import graph. The LLM keeps naming and prose; it loses membership.

## Why average linkage was rejected — it fails the 4b fixture

An earlier draft of this algorithm scored a candidate merge by **average** retained affinity
across all member pairs. Simulated against `fixtures/cluster-quality-adversarial/manifest.json`,
that does **not** produce the memberships it claimed:

```
avg linkage →  [invoice, backfill]  [billing_worker]  [carrier, label]  [money]  [rotate_logs]
expected    →  [invoice, backfill, billing_worker]  [carrier, label]  [money]  [rotate_logs]
```

Cause: after `invoice`+`backfill` merge, the pair `{invoice, backfill}` vs `{billing_worker}`
averages `(3 + 0) / 2 = 1.5`, below `MERGE_THRESHOLD = 2` — even though `billing_worker` has a
weight-3 edge to `invoice`. **Average linkage penalizes a cluster for growing**, so a real
relationship is diluted by unrelated members and the third billing file never joins.

Fix: **single linkage** — score a candidate pair by the *maximum* retained affinity across member
pairs. Verified to reproduce the intended billing / shipping / money / ops partition exactly.
(Mean-over-connected-pairs also passes and is equivalent on this fixture; `max` is simpler, so it
wins on the Simplicity criterion.)

Single linkage's known weakness is chaining. It is accepted deliberately rather than mitigated by a
cohesion rule — see "Expected behaviour, including chaining" below for why any such rule re-breaks
this same fixture.

## Design

### Algorithm

New `packages/interpreter/src/cluster.ts`, pure and provider-free:

```ts
export const CLUSTERING_ALGORITHM = "agglomerative-single-linkage";
export const CLUSTERING_VERSION = "1";
export const MIN_EDGE_WEIGHT = 2;
export const RELATIVE_EDGE_RATIO = 0.25;
export const MERGE_THRESHOLD = 2;
export const MAX_CLUSTER_SHARE = 0.25;
export const MIN_LARGE_REPO_FILES = 20;

/** Membership keyed by canonical structural id — never by name. */
export type ClusterGroups = Map<string, string[]>;

export function clusterFiles(files: string[], edges: ImportEdge[]): ClusterGroups;
```

**Output contract.** `clusterFiles` deliberately does *not* return `ClusterProposal`
(`checker.ts:15` — `Record<string, string[]>`, keyed by *name*), because at this point no name
exists. It returns `ClusterGroups`: keys are the canonical structural id `layerIdFor(members)`,
values are the sorted member paths. Naming is a strictly later step that maps
`ClusterGroups → ClusterProposal` once names are resolved (carried-over or LLM-assigned). Nothing
before that step may read a name.

`layerIdFor` is currently a private `function` in `orchestrate.ts:140` and is not importable.
**Move it to `cluster.ts` and export it**, then have `orchestrate.ts` import it from there — it is
the id rule for the algorithm's output, so `cluster.ts` is where it belongs, and the move keeps one
definition rather than two. Its body is unchanged (sha1 over sorted membership, sliced to 12), so
ids in existing snapshots stay valid; the three call sites at `orchestrate.ts:504`, `:513`, `:517`
just change their import.

The returned `Map` is built by inserting groups **in ascending structural-id order**, so iteration
order — and therefore any serialization of it — is canonical. Tie-breaking makes the *membership*
deterministic; this makes the *output* byte-stable, and the two are separate requirements.

0. **Input filtering.** `clusterFiles` must receive only analyzed, non-generated files. Test
   exclusion already exists (`isTestUnit`, `orchestrate.ts:122` → `isTestPath`,
   `packages/extractor/src/qualname.ts:20`). **Generated exclusion does not exist and must be
   built** — the 4b fixture requires it (`cluster-quality-adversarial.test.ts:97-101` asserts
   `app/generated/pb_orders.py` is excluded) and nothing in the interpreter implements it. Add
   `isGeneratedPath(relPath)` as a sibling of `isTestPath` in `qualname.ts`, exported from
   `packages/extractor/src/index.ts`, matching a `generated`/`__generated__` path segment or the
   filename suffixes `_pb2.py`, `_pb.py`, `.pb.ts`, `.generated.ts`, `.g.dart`. Give it its own
   unit tests, positive and negative. Excluded files are still snapshotted; they are only kept out
   of the clustering graph, and their later placement must not influence membership.
   **One module, one file.** `clusterFiles` partitions *files*, but `parentOverride` is keyed by
   *unit* (`orchestrate.ts:506`). If a module unit ever held two files landing in different
   clusters, the loop would silently assign it to whichever cluster iterated last — a broken
   hierarchy that `assertStrictPartition` cannot see, since its input is file-level and valid.
   Today this cannot happen: `snapshot.ts:22` builds every module as `files: [unit.loc.file]` from
   the extractor's single-file `loc.file`, so the array is always a singleton. But `Unit.loc.files`
   is an unconstrained `z.array(z.string())` (`schema/src/index.ts:79`) and `orchestrate.ts:454`
   already loops over it, so nothing enforces the invariant. **Assert it rather than inventing an
   ownership rule for a case that cannot arise**: when building `unitsByFile`, throw if a module
   unit has `loc.files.length !== 1`. A rule like "own the lexicographically smallest file" would be
   dead code that quietly weakens the contract — a multi-file module means the extractor changed,
   and clustering must be re-designed deliberately, not silently coerced. `Layer.files`, `loc.files`
   and the structural ids are then unaffected by construction.
1. **Normalize.** Sort files lexicographically. Drop self-edges and any edge with an endpoint not
   in `files`. **Duplicate same-direction edges are summed**, matching how the caller already
   aggregates file-pair weights (`orchestrate.ts:485`, `(get(key) ?? 0) + edge.weight`) — so
   `clusterFiles` is safe to hand a raw, unaggregated edge list and agrees with the pre-aggregated
   one it gets today. Summing is correct *within* a direction: two imports of the same module from
   the same file are two facts about one relationship. The `max` in step 2 applies only *across*
   the two directions.
2. Undirected affinity `max(w(a→b), w(b→a))` — `max`, not sum, so a high-fan-in utility cannot be
   pulled into a cluster by many weak inbound edges. This is what keeps `app/shared/money.py` a
   singleton in the fixture.
3. **Edge retention.** The relative threshold must pass for *both* endpoints — an edge survives
   only if it is significant at each end, so a weak tie from a hub is dropped even when it is the
   only tie its leaf has:

   ```text
   retain(a, b) iff  w(a,b) >= max(
     MIN_EDGE_WEIGHT,
     RELATIVE_EDGE_RATIO * maxIncidentWeight(a),
     RELATIVE_EDGE_RATIO * maxIncidentWeight(b),
   )
   ```

   where `maxIncidentWeight(x)` is the largest undirected affinity incident on `x` before
   retention. Computing it pre-retention keeps the rule order-independent.
4. One singleton cluster per file.
5. Repeatedly merge the best eligible pair (single-linkage score `>= MERGE_THRESHOLD`) until none
   remain; reject a merge exceeding `MAX_CLUSTER_SHARE` when `files.length >= MIN_LARGE_REPO_FILES`.
6. Tie-break, in order: score desc → total retained weight desc → member count asc → sorted
   member-id list ascending. **No insertion order, no filesystem order, no random seed** — the
   final key is a total order over distinct member sets, so the result is byte-stable.
7. **Directory fallback (criterion 3).** If retention leaves no edges at all, return
   `directoryClusters(files)` (`checker.ts:35`) re-keyed by structural id instead of a field of
   singletons. `directoryClusters` is itself deterministic — one bucket per directory, membership
   sorted — so the fallback preserves criterion 1. The fallback is chosen on *no retained edges*
   only, not on a modularity comparison: modularity is not comparable across partitions of
   different granularity (Phase 4a), so using it as a switch would make the output depend on a
   metric 4a already showed cannot rank partitions. `directoryModularity` remains what it is
   today — a reported baseline, not a control input.

Cluster keys are derived from sorted membership, never from a name.

**Expected behaviour, including chaining.** The algorithm is deliberately conservative: strong
relationships form clusters, weak shared dependencies stay boundaries, and unsupported files remain
singletons. Single linkage's chaining risk — one strong edge merging two otherwise-unrelated
clusters — is **accepted, not mitigated by a cohesion rule**, and this is a deliberate choice:

- The two-endpoint retention rule in step 3 is the primary defence. A chaining edge must be strong
  at *both* ends to survive, which is the same evidence that would justify the merge.
- A minimum-support/cohesion rule was considered and rejected. It is exactly the average-linkage
  failure this plan exists to correct: any rule that penalizes a merge for the *rest* of the
  cluster's sparsity re-breaks the 4b billing case, where `billing_worker` joins on a single
  weight-3 edge and nothing else.
- `MAX_CLUSTER_SHARE` bounds runaway growth only at `files.length >= MIN_LARGE_REPO_FILES` (20).
  Below that it is inactive by design — a 25% cap on a 6-file repo forbids any cluster above one
  file. Small repos are therefore unbounded, and the tests must say so rather than imply a cap.

The behaviour is made visible rather than prevented: 4a's `largestShare`/`imbalance` measure a
runaway cluster, and criterion 5's split/merge deltas surface it in a diff.

### Naming: who supplies the name after Pass B's call is deleted

Names come from Pass B today: its `merges` keys become cluster names (`pass-b.ts:41-86, :101-102`),
and `runPassC` (`pass-c.ts:44-67`) takes the name as a key and returns only narration. Deleting Pass
B's provider call removes the only naming source.

Rejected: deterministic names from the dominant directory — it labels a cross-directory partition
by one directory. The 4b billing cluster spans `app/billing/`, `workers/`, `scripts/`.

Chosen: **naming moves into Pass C**, which already sees member files and one-liners — more
evidence than Pass B's directory view. `PassCResponseSchema` (`pass-c.ts:10-17`) gains `name`:

```ts
const PassCResponseSchema = z.object({
  name: z.string().min(1).max(40),
  what: z.string(),
  // … how/when/where/why/confidence unchanged
});
```

`passCPrompt` today is `(name, files, oneLiners, repoContext)` and interpolates the name into
`… cluster of files, named "${name}", exists as a layer …` (`prompts/pass-c.ts:7-10`). There is no
name to pass any more, and the `layerId` must **not** be substituted into that slot — a sha1 hex
slice presented as the cluster's name would poison the very output we're asking for. New signature:

```ts
passCPrompt({ layerId, files, oneLiners, repoContext }): string
```

`layerId` is not shown to the model at all — it is a map key on our side, and the prompt gains
nothing from it. The prompt drops the "named X" clause, describes the cluster by its members, and
asks for `name` as the first response field: a short lowercase identifier (≤40 chars, no `layer`/
`module` suffix, matching what `normalizeClusterName` would accept) naming what the files do.

Returned names pass through `normalizeClusterName` (`checker.ts`), then de-duplicate within a run
(`-2`, `-3` suffixes applied in ascending structural-id order, so still deterministic).
`prompts/pass-b.ts` is then deleted with nothing lost.

This makes criterion 2 implementable: with no predecessor, two providers can genuinely differ.

### The `ClusterGroups → ClusterProposal` sequence

The name-keyed `ClusterProposal` can only be built *after* Pass C, reversing today's order. Inside
`runLayersPass`:

```text
1. clusterFiles(files, edges)              -> ClusterGroups         (Map<layerId, files[]>)
2. assertStrictPartition(groups, files)    -> ClusterGroups         (id-safe safety net, below)
3. for each layerId, ascending:
     predecessor hit  -> reuse Layer wholesale, no LLM call
     predecessor miss -> runPassC({ layerId, files, … }) -> Layer with a raw `name`
4. normalize + de-duplicate names, predecessors first (below)
                                           -> Layer[]  RESOLVED — the only records
                                              persisted, narrated, or carried over
5. build ClusterProposal = { name -> files } and layerIdByName = { name -> layerId }
```

Step 4's output supersedes the raw Pass C records for every downstream purpose: `layerUnits`,
`LayersData.layers`, and the next run's carry-over all read it. Nothing keeps a raw name.

Names are never a key before step 5. Two consequences:

- `runPassC` takes id-keyed `ClusterGroups`, not `ClusterProposal`; its `Layer` gains `name`.
- `runPassB` returns `{groups: ClusterGroups, repaired, modularity, directoryModularity}` — not
  `clusters`. `modularity()` (`checker.ts:139`) reads only membership, so both metrics are
  unaffected.

`layerIdByName` (`orchestrate.ts:513`) comes from step 5's pairing instead of re-hashing `l.files`.

#### Step 2 must not be `checkAndRepairClusters`

`checkAndRepairClusters` (`checker.ts:70-131`) **mutates its keys**: it runs `normalizeClusterName`
on each, merges keys that normalize alike, appends `_group` when a key equals one of its members,
and buckets orphans under the literal `"unclustered"`. Run on structural ids it would mangle them —
a sha1 hex slice is not a name, and rewriting it breaks the id/membership contract everything else
depends on.

Nor is a Map→object→Map round-trip enough: the key-rewriting happens inside, not at the boundary.

So add a separate id-keyed validator in `cluster.ts`:

```ts
export function assertStrictPartition(groups: ClusterGroups, files: string[]): void;
```

It **validates and never repairs or renames** — keys pass through untouched, by construction. It
throws on: a file in two groups, a file in none, a group member absent from `files`, an empty
group, or a key that is not `layerIdFor` of its own members. Throwing rather than repairing is
right here: `clusterFiles` is deterministic and total, so a violation is a bug in the algorithm, not
untrusted LLM output to be salvaged. The repair path existed only because Pass B's input was an LLM
response.

`checkAndRepairClusters` stays for Pass C's *group* merges (`pass-c.ts:104`), which are still
LLM-proposed and name-keyed. Only the layers path stops using it.

#### Step 4: carried-over names win collisions

Suffixing by ascending id would let a *new* cluster push a `-2` onto an unchanged predecessor that
merely sorts later — breaking "unchanged membership ⇒ byte-identical layer", the whole point of
stickiness. Precedence is therefore by origin, not by id:

1. **Carried-over names are claimed first and never altered** — not suffixed, and not re-normalized.
   They were normalized when first assigned and are persisted in the record; re-running
   `normalizeClusterName` on them risks changing a stored name if the function ever changes.
   Two predecessors cannot collide with each other: they were de-duplicated on the run that created
   them, and their names come back verbatim.
2. **New names are then normalized and fitted around them**, in ascending structural-id order — a
   total order, so the outcome is deterministic. A new name colliding with a claimed name (or with
   an earlier new one) takes the first free `-2`, `-3`, … suffix.

So a suffix only ever lands on a name the LLM just invented. A predecessor's name changes only when
its membership changes, which changes its id, which makes it not a predecessor.

### Name stickiness

Today the id is already stable (`layerIdFor`, `orchestrate.ts:140`, sha1 over sorted files) but the
*name* is re-invented every run — `orchestrate.ts:134-139` says so outright ("ops" one run,
"operational-scripts" the next). `normalizeClusterName` (`checker.ts`) absorbs casing and banned
suffixes but not synonyms.

**Carry the whole layer, not just the name.** Pass C emits name *and* narration in one call, so
reusing `{layerId → name}` alone would leave a named layer with no prose. Splitting Pass C into two
calls was rejected (doubles calls, adds a seam nothing else needs); carry the whole record instead:

- thread a `previousLayers?: Map<string, Layer>` (name plus all five narration fields,
  `confidence`, and `source`) into `runLayersPass` and on into `runPassC`;
- for a computed cluster whose id matches a predecessor (identical membership by construction, as
  the id *is* the membership hash), **reuse that entire record** — only `files` is re-derived, and
  it is already equal — and skip the Pass C call for that cluster;
- call the LLM only for ids with no predecessor.

Unchanged membership ⇒ byte-identical layer, deterministically. A rename becomes a deliberate event
rather than run-to-run noise, and it cuts Pass C calls on re-analysis. The narration is as stable as
the name, which is the stronger property and the one a diff actually depends on.

#### Where the predecessor comes from

`runLayersPass` (`orchestrate.ts:448-449`) has no predecessor today; the plumbing must be built.
Source is the CLI's per-sha artifact `.scv/artifacts/<sha>/layers.json`
(`cli/src/artifacts.ts:87-105, :49-54`), not a parsed snapshot.

It must cross shas to be worth anything: the layers `inputHash` (`artifacts.ts:127-136`) folds in
every unit's `semantics.what`, so one changed one-liner invalidates the artifact and re-narrates
every cluster. That churn is what stickiness exists to stop.

- **Selection:** walk the current rev's first-parent ancestry (bounded, 50 steps) and take the
  nearest ancestor sha with a readable `layers.json`. Ancestry, not mtime, so a stale branch cannot
  poison it.
- **No predecessor** — first analyze, shallow clone, corrupt file, bound exhausted — is not an
  error: `previousLayers` is `undefined`, everything is narrated. Read it guarded like
  `readSnapshot` (`cli/src/diff.ts:26-45`): degrade, never throw.
- Resolved in `analyze.ts`, passed via `ArtifactContext` to `computeArtifact("layers", …)`
  (`artifacts.ts:177-195`). **Not** folded into the layers `inputHash` — that would defeat the
  same-sha cache it complements.

#### What `LayersData` must gain

Three additions, all in `artifacts.ts:49-54`.

**1. The layers themselves.** `layerUnits` is `Unit[]`, not `Layer[]`, and the conversion at
`orchestrate.ts:521-542` is **not invertible**: `Unit.loc.files` (`:530`) is the union of the
member *units'* files, while `Layer.files` — the list `layerIdFor` hashes (`:517`) — is the
cluster's file list. They diverge when a unit spans files or a file yields no unit (`:518`, `:520`
drops it). Reconstructing a `Layer` from a `Unit` would therefore silently re-key it. The rest
does round-trip (`name` ← `unit.name`; the five narration fields, `confidence`, `source` ←
`unit.semantics`), but one unsound field is enough.

So **persist the `Layer` records directly** rather than converting at the boundary:

```ts
interface LayersData {
  // … existing fields
  layers: Layer[];             // resolved layers (step 4 output) — the carry-over source
  clusteringVersion: string;   // CLUSTERING_VERSION at write time
  promptRev: string;           // ctx.promptRev at write time
}
```

**Persist the step-4 output, not `passC.layers`.** A raw Pass C record still holds the LLM's
un-normalized, un-suffixed name; step 4 is what resolves it. Persisting the raw record would store
a name the snapshot never used, and the next run would carry it over — re-deriving or double-adding
a suffix, which is exactly the churn stickiness exists to stop. So step 4 produces the single
canonical `Layer[]`, and **both** `layerUnits` (`orchestrate.ts:521-542`) and `LayersData.layers`
are built from it. Names are then identical across the snapshot, the artifact, and the next run's
carry-over by construction.

`previousLayers` is then `new Map(data.layers.map((l) => [layerIdFor(l.files), l]))` — no lossy
mapping anywhere. `layerUnits` stays in `LayersData` too; it is what the snapshot needs, and the
two coexist.

**2 & 3. Compatibility fields.** Reuse requires the same algorithm and prompts, and the artifact
holds no provenance. Rejected: reading `snapshots/<sha>.json` too — a second file that may be
absent or stale relative to the artifact (`--no-llm` writes a snapshot without re-running layers).
One self-describing file wins. Carry over only when both values equal the current ones; either
absent ⇒ narrate everything.

**Invalidation.** Bump `ARTIFACT_SCHEMA_VERSION` (`artifacts.ts:25`) to `"3"` — and note that
alone is inert here: `computeInputHash` folds it into the `groups` hash but **not** the `layers`
one (`artifacts.ts:127-145`), so a pre-4c `layers.json` with an unchanged input hash would still be
reused despite lacking the new fields. **Add `ARTIFACT_SCHEMA_VERSION` to the `layers` case**, as
`groups` already does. The absent-field guard above then only ever fires for a *predecessor* sha's
artifact, which is the case the version bump cannot reach.

The snapshot's `provenance.clustering` block below is still written; it documents the run for
readers and diffs. It is simply not what the carry-over reads.

### Behaviour as code is added (the user's question)

Simulated against the fixture:

| Change | Result |
|---|---|
| New file with a strong tie to one cluster | Joins that cluster. Other clusters **may remain byte-identical — when no retained edge and no merge eligibility changes**; in that case their ids survive and the diff reads "one layer gained a module" |
| New file with only weak ties | Stays a singleton — below the retention threshold |
| New file strongly tied to **two** clusters (a bridge) | The two clusters **merge**: two ids disappear, one new id appears |

The first row is deliberately hedged. A new file raises `maxIncidentWeight` at every endpoint it
touches, which can push a previously retained edge *below* the relative threshold in step 3, and a
rejected `MAX_CLUSTER_SHARE` merge can become eligible (or stop being so) as `files.length` grows.
Neither is common, but "every other cluster is byte-identical" is not a guarantee the algorithm
makes, and the tests must not assert it as one.

The bridge case is the honest cost of single linkage. It is not a bug — the coupling is real — but
one file can restructure the map. `MAX_CLUSTER_SHARE` bounds it, and the split/merge `relationship`
deltas (criterion 5, already in the schema at `schema/src/index.ts:289-295`) make it explicit in a
diff instead of silent churn. `clusteringQuality`'s `largestShare`/`imbalance` (Phase 4a) make a
runaway cluster measurable rather than invisible.

### Provenance (criterion 6)

Extend `SnapshotProvenanceSchema` (`packages/schema/src/index.ts:210-213`) with an **optional**
sibling — optional so the six existing snapshots in `.scv/` still parse, the same additive rule the
plan already applies to `rollupProvenance`:

```ts
clustering: z.object({
  algorithm: z.string(),
  version: z.string(),
  tieBreak: z.string(),
  constants: z.record(z.string(), z.number()),
}).optional()
```

No `seed` field: the algorithm is seedless by construction, and a schema slot for a seed that is
always absent advertises a knob that does not exist. The tie-break rule is recorded as a string
because that, not a number, is what explains a moved boundary.

Written at `orchestrate.ts:976-983`, beside the existing `interpreter` provenance.

### Integration

The seam is narrow. `runPassB` currently returns `{clusters, repaired, modularity, directoryModularity}`
and is consumed only via `passB.clusters` at `orchestrate.ts:501` and `:510`.

- `pass-b.ts`: delete `applyDirectoryMerges`, `PassBResponseSchema`, and the provider call.
  `runPassB` becomes a thin deterministic wrapper over `clusterFiles`, returning
  `{groups: ClusterGroups, repaired, modularity, directoryModularity}` — the `clusters` field
  changes to id-keyed `groups`, as the sequence above requires; `RunLayersPassResult` keeps its
  external shape because the name-keyed `ClusterProposal` is rebuilt at step 5.
  `directoryModularity` stays — it is the baseline the new partition is measured against, and 4a
  made that comparison meaningful.
- `packages/interpreter/src/prompts/pass-b.ts`: delete once naming has moved into `passCPrompt`.
  Nothing else imports it (verify with grep before removing).
- Pass C still narrates per cluster, but its input keys are now algorithm-derived, and the
  stickiness carry-over decides whether it is called at all — per cluster, not per run: a snapshot
  can reuse four layers verbatim and narrate the one that changed.
- The layers strict-partition guarantee Phase 1 relies on for parenting now comes from
  `assertStrictPartition`, not `checkAndRepairClusters` (which would rewrite structural ids — see
  step 2 above). `checkAndRepairClusters` is unchanged and still used by Pass C's group merges.

## Files

- new `packages/interpreter/src/cluster.ts` (`clusterFiles`, `layerIdFor`, `assertStrictPartition`) ·
  new `packages/interpreter/test/cluster.test.ts`
- `packages/extractor/src/qualname.ts` (new `isGeneratedPath`, sibling of `isTestPath`:20) ·
  `packages/extractor/src/index.ts` (export it) · `packages/extractor/test/qualname.test.ts`
- `packages/interpreter/src/pass-b.ts` (gutted to a wrapper) · delete `src/prompts/pass-b.ts`
- `packages/interpreter/src/orchestrate.ts` (:122 filter the clustering input by `isGeneratedPath`
  alongside `isTestUnit`; :140 `layerIdFor` **moved out** to `cluster.ts` and imported, call sites
  :504/:513/:517 unchanged otherwise; :451-457 assert one file per module unit; :495-545 layer
  carry-over and predecessor-first name de-duplication; :976-983 provenance;
  `RunLayersPassResult` (:432-441) gains `layers: Layer[]` — the **step-4 resolved** records, which
  :521-542 also builds `layerUnits` from)
- `packages/interpreter/src/pass-c.ts` (`name` first in the response schema; id-keyed input; skip
  the call for ids with a predecessor; `checkAndRepairClusters` stays for its group merges at :104)
- `packages/interpreter/src/prompts/pass-c.ts` (signature → `passCPrompt({ layerId, files,
  oneLiners, repoContext })`; drop the `named "${name}"` clause; ask for `name` first)
- `packages/cli/src/analyze.ts` + `src/artifacts.ts` (predecessor sha by first-parent ancestry;
  `LayersData` gains `layers: Layer[]` + `clusteringVersion`/`promptRev`;
  `ARTIFACT_SCHEMA_VERSION` → `"3"` **and folded into the `layers` input hash** at :127-136;
  pass via `ArtifactContext`)
- `packages/schema/src/index.ts` (:210-213)
- `packages/interpreter/test/cluster-quality-adversarial.test.ts` (add the criterion-6 assertion)
- `docs/plans/hierarchy-correctness-and-clustering-redesign.md` (mark 4c) · `README.md` (per-milestone rule)

## Verification

TDD RED first per CLAUDE.md. Tests, mapped to the six acceptance criteria:

1. **Determinism** — `clusterFiles` over shuffled input file order and shuffled edge order yields
   byte-identical membership and ids across 100 permutations, **and identical `Map` iteration
   order** (assert on `[...groups.keys()]`, not just on the grouping), since canonical output
   ordering is a separate property from deterministic membership. Plus: duplicate same-direction
   edges sum — `[{a→b,1},{a→b,1}]` yields the same partition as `[{a→b,2}]`; self-edges and edges
   with an unknown endpoint are dropped without affecting the result.
2. **No LLM influence** — run the full layers pass with two stub providers returning different
   names, against **no predecessor snapshot**, and assert: membership and layer ids identical;
   names differ. A second case with a predecessor asserts the complement — unchanged ids reuse the
   predecessor name under *both* providers, so names are identical there. Stated this way the two
   provider-variation cases and the stickiness test below agree instead of contradicting: names may
   diverge across providers only where no predecessor name exists.
3. **Deterministic fallback** — no retained edges ⇒ `directoryClusters(files)`, keyed by structural
   id, stable across shuffled input order; empty file list ⇒ empty result.
4. **Named thresholds with boundary tests** — an edge at exactly `MIN_EDGE_WEIGHT` retained and one
   below dropped; an edge failing the relative threshold at *only its second* endpoint dropped
   (step 3's both-endpoints rule); a merge at exactly `MERGE_THRESHOLD` accepted; a cluster at
   exactly `MAX_CLUSTER_SHARE` accepted and one over rejected; the cap inactive below
   `MIN_LARGE_REPO_FILES`.
5. **Split/merge deltas** — the bridge-file scenario across two snapshots emits `relationship`
   entries rather than unexplained add/remove churn.
6. **4b in CI** — `clusterFiles` over the fixture manifest reproduces `expected` exactly, up to
   cluster names; excluded files influence nothing; and provenance round-trips through
   `SnapshotSchema`.

Plus:

- **Generated exclusion** — `isGeneratedPath` unit tests (positive: `app/generated/pb_orders.py`,
  `x_pb2.py`, `foo.generated.ts`; negative: `app/generator.py`, `generated_report.py`), and the 4b
  assertion that every path in the fixture's `excluded` is absent from the clustering input.
- **Accepted chaining** — an explicit test naming the behaviour: two cohesive clusters joined by a
  single edge strong at both endpoints *do* merge, and the assertion documents this as intended.
  A companion small-repo case asserts the merge is **not** blocked below `MIN_LARGE_REPO_FILES`.
- **Stickiness** — identical membership across two runs ⇒ the layer is **byte-identical**, name and
  all five narration fields and `confidence` (not just the name — that is what makes skipping the
  call sound), and **zero** Pass C calls (assert on a counting stub); changed membership ⇒ the LLM
  is called for the new ids only; a changed `CLUSTERING_VERSION` or `promptRev` ⇒ the carry-over is
  ignored and every cluster is re-narrated.
- **Growth is not over-promised** — the "new file joins one cluster" case asserts the *joined*
  cluster changed and the others are unchanged **in that scenario**, with a companion case where a
  new file raises `maxIncidentWeight` enough to drop a previously retained edge, proving the
  weaker claim in the table is the honest one.
- **Strict partition** — `assertStrictPartition` throws on each violation separately (file in two
  groups, file in none, member not in `files`, empty group, key ≠ `layerIdFor` of its members), and
  on a valid partition returns without mutating: keys and member order are identical afterwards.
  A regression case feeds it input `checkAndRepairClusters` *would* have silently rewritten (a key
  colliding under `normalizeClusterName`) and asserts a throw instead.
- **Naming** — Pass C returns a `name`; `passCPrompt` output contains the file list but **not** the
  `layerId`; two *new* clusters yielding the same normalized name get deterministic `-2` suffixes,
  assigned in ascending structural-id order; a name-keyed key appears nowhere before step 5.
- **Collision precedence** — a new cluster whose name normalizes to an unchanged predecessor's name
  takes the suffix itself; the predecessor stays byte-identical, **including when its id sorts
  after the new one** (the case naive id-order suffixing gets wrong). A carried-over name is not
  re-normalized: a predecessor whose stored name no longer survives `normalizeClusterName`
  unchanged is still reused verbatim.
- **One module, one file** — a module unit with two files in `loc.files` throws when `unitsByFile`
  is built, rather than being silently assigned to the last cluster iterated.
- **Artifact round-trip** — a `LayersData` written and re-read yields `Layer` records **equal to the
  step-4 resolved layers** (name, all five narration fields, `confidence`, `source`, `files`), and
  each `layer.name` equals the corresponding `layerUnit.name` while `layerIdFor(l.files)` equals its
  `layerUnit.id`. A companion case pins why the records are persisted rather than reconstructed: a
  layer whose `Layer.files` differs from its `Unit.loc.files` (a file with no unit) — rebuilding
  from the `Unit` would change the id.
- **Suffixes survive persistence** — a run where a new cluster takes a `-2` persists the *suffixed*
  name, not the raw Pass C name; re-analyzing against that predecessor reuses the suffixed name
  unchanged and does **not** append a second suffix.
- **Version invalidation** — a stored `layers.json` whose `inputHash` was computed under
  `ARTIFACT_SCHEMA_VERSION = "2"` is **not** reused after the bump (the regression the bump alone
  did not catch); an unchanged version with unchanged inputs still hits the cache.
- **Predecessor plumbing** — no predecessor (first analyze), unreadable file, absent
  `layers`/`clusteringVersion`/`promptRev` in a v2 `LayersData`, and mismatched values each fall
  back to narrating everything, with no throw;
  a valid predecessor reached across two different shas reuses layers, proving the carry-over
  crosses shas rather than relying on the same-sha artifact cache.

Then `npm test` and `npm run lint` (never bare executables). `npx tsc -b packages/schema
packages/interpreter` — `npm test` does not typecheck and workspace packages resolve to built
`dist/`, so a stale `dist` silently exercises old code.

End-to-end: analyze `fixtures/orderly` twice and confirm byte-identical layer ids and names; then
`npm run dev` and confirm drill/ascend still traverse system → group → layer → module.

Branch `feature/deterministic-clustering`; branch → implement → verify → `project-review` → PR.
Never commit to main.

## Out of scope

Phase 5 (2D edge budgets and bundling). The 3D/cityscape reassessment stays blocked on visual
acceptance criteria that do not exist in the repo.

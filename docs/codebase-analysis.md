# codebase-analysis — current pipeline vs. intended pipeline, and the plan to close the gap

> Companion to [`analyze.md`](analyze.md) (intent/behaviour) and [`design.md`](design.md) (schema
> contract, formulas). This document exists because the two have drifted: `analyze.md` already
> *describes* the intended algorithm correctly in places the code does not implement. This
> document traces the **actual code**, phase by phase, states the **intended** algorithm as
> re-articulated in this session, marks exactly where they diverge, and lays out a plan to close
> each gap.

---

## 0. The intended algorithm, restated

The shape we want (source of truth: this session's discussion, consistent with `analyze.md §2`
where it already says this):

1. **Build a call-graph analytical structure from syntax** — folder structure and text only, no
   LLM. This is a deterministic, cacheable structural graph: every function/class, every
   call/import/inherit edge, resolved as far as static analysis can go.
2. **Ask the LLM for an interpretation of each function, *given the relevant slice of that
   graph*** — not the function in isolation. "Relevant slice" means: this function's callers,
   this function's callees, its containing file/class, maybe its siblings — whatever subset of
   the graph actually informs "why does this exist" without blowing up token budget per call.
3. **Use the interpretations *and* the graph structure together to derive modules and
   architecture groupings** — clustering isn't just LLM-vibes-based partitioning of files; it's
   informed by both the semantic content (what Pass A said) and the structural content (the edge
   graph itself: import cohesion, call cohesion).
4. **Diff folds into this same algorithm afterward** — the diff/risk phase is a second pass over
   the same structures (graph + interpretations), not a separate parallel system.

This document is organized around those four phases. For each, "Current" describes the code as
it exists today (verified by reading the source, file:line cited); "Intended" restates the
target from above; "Gap" says exactly what's missing; "Plan" says what to build.

---

## 1. Structural extraction (syntax → call graph)

### Current

Fully deterministic, no LLM, matches intent closely. Entry point: `packages/cli/src/analyze.ts`.

1. **File discovery + parse.** `packages/extractor/src/host.ts:30-44` walks the repo (skipping
   `.git`, `node_modules`, `.scv`, etc.), tree-sitter-parses each file per its language.
2. **Fact extraction.** Per-language walkers (`walk-typescript.ts`, `walk-python.ts`) emit a
   uniform fact stream: `DefFact` (module/class/function definitions), `ImportFact`, `RefFact`
   (call-site references), `InheritFact`. `collectRefs()` walks each function body's AST
   specifically for `call_expression` nodes (`walk-typescript.ts:102-135`) — this is the ceiling
   of what's captured; no control-flow (if/else/loop) is parsed, only call sites.
3. **Resolution.** `packages/extractor/src/resolve.ts:73-311`, two passes:
   - Pass 1 (`resolve.ts:79-105`): builds a symbol table (qualname → definition) per file,
     including nested class/method hierarchy.
   - Pass 2 (`resolve.ts:163-284`): resolves each `RefFact`/`ImportFact` into a `SymbolEdge`
     (`kind: "calls" | "imports" | "inherits"`), matching bare names against local defs, imported
     bindings, and attribute-style calls (`obj.method()`). Confidence: 1.0 for local/explicit-
     import matches, lower for probable/unresolved matches — **unresolved references are kept as
     low-confidence edges, never dropped** (this matches `analyze.md:17`'s stated design).
   - Metrics: `fanIn`/`fanOut` counts computed per unit as edges are folded in
     (`resolve.ts:286-292`).
4. **Manifests + VCS.** Package manifests → `SymbolExternal[]` (`manifest.ts`); `git log
   --numstat` → per-file churn (`vcs.ts`).
5. **Output: `SymbolGraph`** (`symbol-graph.ts:65-69`) — `{ units, edges, externals }`. This is
   the full call-graph analytical structure. It has both directions available: filtering
   `edges` by `to === unitId` gives callers, by `from === unitId` gives callees. Nothing about
   this requires an LLM and nothing here is missing relative to intent.

### Intended

Same as current. Phase 1 is not where the gap is.

### Gap

None structurally. The one open question is depth: `analyze.md:16` promises `route`, `io_call`
as fact kinds alongside `def`/`ref`/`import`/`inherit`; only the latter four are confirmed
implemented in the walkers traced this session — worth a follow-up check, not blocking.

### Plan

No change needed to close phase 1 against the stated intent. (Function-internal control-flow
extraction — the separate "flowchart" ask from earlier in this session — would be a phase-1
extension, tracked separately; not required for the module-grouping problem this document is
scoped to.)

---

## 2. Per-function interpretation (Pass A)

### Current

`packages/interpreter/src/pass-a.ts` + `packages/interpreter/src/prompts/pass-a.ts`, invoked
from `orchestrate.ts:62-83` (concurrency-limited, `PASS_A_CONCURRENCY = 2`).

**The call graph built in phase 1 is available in scope at the Pass A call site
(`orchestrate.ts:65-70`) but is not used.** `runPassA` receives only:

```ts
interface RunPassAOptions {
  unit: SymbolUnit;   // qualname, lang, loc, kind — metadata only
  source: string;      // the isolated source text of this one unit
  provider: Provider;
  promptRev: string;
}
```

The prompt (`prompts/pass-a.ts:4-38`) interpolates `unit.kind`, `unit.qualname`, `unit.lang`,
`unit.loc.file`, and the raw `source` — nothing else. No caller list, no callee list, no sibling
functions in the same file, no imports. Each of the *L* Pass A calls (one per function/class,
no batching) runs in total isolation from every other call and from the graph itself.

**This is a documented drift, not a new idea.** `analyze.md:34` already states the intent:
> "Pass A — leaf semantics. Per function and class: **source plus resolved neighbours** →
> `what / how / when / where / why`..."

The code was never wired up to do the "resolved neighbours" part.

### Intended

Pass A should receive, per unit, a relevant slice of the graph from phase 1: at minimum the
qualnames of its direct callers and callees (from `SymbolGraph.edges`, filtered by `kind ===
"calls"` and `to === unit.id` / `from === unit.id`). Possibly also: its containing class/file's
other members, and import context. The goal is that `where` ("where it sits in the system") and
`why` ("why it exists") are answered from actual position in the graph, not inferred from
source-code style alone.

### Gap

`graph.edges` (or `snapshot.edges`, either is equivalent at this point in `orchestrate.ts`) is
already fully materialized and in scope — this is cheap to compute (a filter over an
already-built array, not new extraction) and cheap to add to the prompt (a short list of
qualnames, not more source code — negligible token cost per call). The gap is purely: nobody
threads it from `orchestrate.ts` into `runPassA`'s options and into the prompt template.

### Plan

1. `pass-a.ts`: extend `RunPassAOptions` with `callers: string[]` and `callees: string[]`
   (qualnames, resolved by the caller of `runPassA`, not by `runPassA` itself — keep this pass
   free of graph-walking logic, consistent with how every other pass here receives pre-shaped
   inputs).
2. `prompts/pass-a.ts`: add a short "Callers:" / "Callees:" section to the prompt template,
   rendered only when non-empty (a function with no callers/callees — e.g. a true entry point or
   dead code — should not get a misleading empty section that reads as "nothing calls this").
3. `orchestrate.ts`: at the Pass A call site (~line 65-70), before calling `runPassA`, compute
   `callers`/`callees` for `symbolUnit.id` from `graph.edges` (a `Map<unitId, {callers, callees}>`
   precomputed once outside the per-unit loop, not recomputed per call — O(edges) once, not
   O(edges × units)).
4. **Cache-key implication:** Pass A's cache key is `input_hash (struct+src) + prompt_rev`
   (`analyze.md`'s "content-addressed cache" design, `cache.ts`). Adding callers/callees to the
   prompt without changing the cache key would silently serve stale interpretations after a
   caller/callee changes even though this unit's own source didn't. Either (a) fold a hash of
   the caller/callee qualname list into the cache key, or (b) bump `promptRev` so this is a
   one-time full invalidation and rely on struct-hash-of-edges going forward. Needs an explicit
   decision before implementation — flagged here, not resolved.
5. **Token/cost budget check.** Confirm this doesn't blow up Pass A's cost on high-fan-in/fan-out
   units (a utility function called from 200 places). Consider a cap (e.g. top-N callers by some
   ordering, or just the count + a sample) rather than an unbounded list — needs a concrete
   number chosen during implementation, not left open-ended.

---

## 3. Clustering and architecture grouping (Pass B / Pass C / new grouping step)

### Current

Two LLM passes, both already consuming Pass A's *output* (not the graph directly, for Pass B's
semantic content) plus real structural data (for Pass B's edges):

- **Pass B — clustering** (`pass-b.ts`, `orchestrate.ts:177`, one call total, not per-file).
  Input: file list, `oneLiners` (intended: per-file, Pass A's `semantics.what` rolled up from
  that file's units), and `importEdges` — aggregated **from `snapshot.edges` (i.e. from the
  phase-1 graph)**, file-pair-keyed edge weights (`orchestrate.ts:163-175`). Pass B *should*
  already combine interpretation output (oneLiners) with graph structure (importEdges) — this
  part is architecturally right — **but see the bug below: `oneLiners` is broken today, so in
  practice only `importEdges` is real input.** Output: `Record<string, string[]>` (cluster name
  → files), proposed by the LLM, then deterministically validated/repaired by `checker.ts`
  (every file assigned, no orphans) — this determinism is load-bearing per `analyze.md:42-44`
  and must be preserved by any change here.
- **Pass C — layer narration** (`pass-c.ts:42-68`, one call per Pass B cluster). Input: a
  cluster's files + their `oneLiners` (same broken input as Pass B — see below). Output:
  `what/how/when/where/why` for the layer as a whole, becoming a `kind: "layer"` `Unit`. **This
  is where the current pipeline stops.** Every layer becomes a flat, direct child of the `system`
  unit (`orchestrate.ts:230-258`, later reparented but never nested under anything coarser). For
  this repo that's on the order of ~40 layers with no further grouping — this is the literal
  cause of "the LLM is giving the next layer of modules as the root layer" (this session's
  original complaint).

#### Bug: `oneLiners` is `"(no summary)"` for every file, every run

Found by reading actual Pass B/C prompt text via the new INFO-level LLM-call logging
(`packages/interpreter/src/log.ts`, enable with `interpreter.logLevel: info` in
`.scv/config.yaml` or `scv analyze --log-level info`) — every file line reads
`- path/to/file.ts: (no summary)`, unconditionally.

Root cause, `orchestrate.ts:144-156`:

```ts
const unitsByFile = new Map<string, Unit[]>();
for (const unit of unitsWithBlockChildren) {
  if (unit.kind !== "module") continue;          // <- only module units kept
  for (const file of unit.loc.files) {
    (unitsByFile.get(file) ?? unitsByFile.set(file, []).get(file)!).push(unit);
  }
}
const oneLiners: Record<string, string> = {};
for (const [file, fileUnits] of unitsByFile) {
  const withSemantics = fileUnits.find((u) => u.semantics);  // <- always undefined
  oneLiners[file] = withSemantics?.semantics?.what ?? "(no summary)";
}
```

`unitsByFile` keeps only `kind === "module"` units. But Pass A (`orchestrate.ts:40,63`,
`LEAF_KINDS = new Set(["function", "class"])`) only ever writes `.semantics` onto
`function`/`class` units — module units never get `.semantics`. So `fileUnits.find((u) =>
u.semantics)` searches a list that by construction can never contain a match, and every file
falls back to the literal fallback string.

This is not a pass-ordering bug — Pass A does run before Pass B/C. It's that the file→one-liner
rollup reads the wrong unit: the module unit instead of the function/class units nested inside
that file, which is where Pass A's output actually lives. Net effect for phase 3 as a whole:
**Pass B currently clusters on `importEdges` alone (oneLiners contributes nothing), and Pass C
narrates each layer from filenames + nothing else** — the "interpretations and graph structure
together" principle in §0 is not met in practice today, even though the plumbing to meet it
already exists and mostly works.

Neither pass fails or throws — the fallback string is valid prompt input — so this shipped
silently and would have stayed invisible without reading raw query text.

**Fix**, folded into the Plan below: build the one-liner from each file's function/class units
(a `LEAF_KINDS.has(unit.kind)` grouping, not `kind === "module"`), reducing each file's leaf
`.semantics.what` values into one line. Needs a regression test asserting `oneLiners[file]` is
not the literal `"(no summary)"` string once the file has at least one summarized unit, so this
can't regress silently again.

### Intended

Phase 3 should have one more level: after Pass C produces layers, bucket those layers into a
small number of named architectural groups (the earlier session's mockup comparison called
these "API SURFACE" / "CORE DOMAIN" / "PLATFORM"; this repo's natural equivalent is closer to
`server` / `interpreter` / `extractor` / `differ` / `skins`, i.e. one level above the ~40
fine-grained layers). This grouping should, per the "interpretations and graph structure
together" principle, ideally also be informed by cross-layer edge weight (which layers call
into which other layers most), not purely by the LLM eyeballing layer names — mirroring how
Pass B already uses both `oneLiners` and `importEdges` together, not just names.

### Gap

No grouping-of-layers step exists at all today. This is the concrete, scoped gap already covered
by the separate implementation plan in progress this session
(`~/.claude/plans/soft-bubbling-valley.md`, Part A): a new post-Pass-C step, following the same
propose-then-repair discipline as Pass B, taking Pass C's `layers[]` (name + what/why) as input
and producing a `group` assignment per layer.

**One refinement this document surfaces that the in-progress plan does not yet account for:**
per the "graph structure, not just interpretations" principle, the new grouping step should
also receive **layer-to-layer edge weights** (rolled up from `graph.edges`/`snapshot.edges`,
analogous to how `importEdges` are already rolled up to file-pairs for Pass B at
`orchestrate.ts:104-116` — the same rollup, one level higher, keyed by layer id instead of file
path), not just layer names + semantics. This keeps the new pass consistent with how Pass B
already operates, rather than introducing a purely-semantic-text-based grouping step that
ignores structure the codebase already computes.

### Plan

(Supersedes/extends Part A of `soft-bubbling-valley.md` with the edge-weight input.)

0. **Fix the `oneLiners` bug above first** — it's upstream of everything else in this section
   and currently silently starves Pass B/C of the interpretation half of their input. Add
   `leafUnitsByFile` (group by `LEAF_KINDS.has(unit.kind)` instead of `kind === "module"`) and
   derive `oneLiners[file]` from that file's leaf units' `.semantics.what`, with a regression
   test pinning "not the literal fallback string when a summarized unit exists in that file."
1. After Pass C completes (`orchestrate.ts`, after line 132/161), compute layer-to-layer edge
   weights: for each edge in `graph.edges`/`snapshot.edges`, map both endpoints to their layer
   id (reuse the `parentOverride`/`layerIdFor` machinery already built at
   `orchestrate.ts:124-130`), sum weights per layer pair, same shape as the existing
   `importEdges` computation but one level up.
2. New prompt (`prompts/pass-c-groups.ts`, modeled on `prompts/pass-b.ts`): input = layer names
   + `what`/`why` (from Pass C) + layer-to-layer edge weights (from step 1). Ask for ~3-6 named
   groups, every layer assigned to exactly one.
3. Repair step, same pattern as `checker.ts`'s cluster repair: drop group assignments
   referencing unknown layer names; any layer the LLM leaves unassigned falls into a catch-all
   group (e.g. "other") rather than failing the run.
4. Schema: add `group: string | null` to `Unit` (`packages/schema/src/index.ts`), set on layer
   units in the `newUnits.push({...})` block (`orchestrate.ts:139-160`).
5. This `group` field is then what the separate UI plan (region boxes, left-rail tree) consumes
   — that plan is otherwise unchanged by this document.

---

## 4. Diff folds into the same algorithm

### Current

`packages/differ/src/diff.ts` + `diff-with-risk.ts`, invoked from `packages/cli/src/diff.ts`.
Operates on two already-fully-lifted `Snapshot`s (before/after), **not** on the graph or
interpretations directly — it consumes their *output* (the `Unit[]`/`Edge[]` with hashes and
semantics already attached), which is consistent with "diff folds into this algorithm
afterward," structurally:

1. **Match** units by id across snapshots.
2. **Classify**: compare `hash.struct`/`hash.text`/`hash.semantic` → status (added/removed/
   modified/unchanged) + `amount` (0-1 change magnitude, weighted combination of sloc delta,
   text-changed, struct-changed, semantic-changed).
3. **Blast radius**: BFS over the reversed edge graph (the *new* snapshot's edges), capped at
   depth 4 (`diff.ts`'s `blastRadius` function) — this directly reuses the phase-1 graph
   structure (via the snapshot's edge list), not a separate diff-specific graph.
4. **Formula floor**: deterministic risk baseline from `amount` + blast radius + public-API
   boost — no LLM.
5. **Pass D — risk narration** (`pass-d.ts`, `diff-with-risk.ts:30-59`): LLM call *per changed
   module*, not per all units — input includes the unit's `what`/`why` (Pass A/C's output, reused
   here) plus blast radius plus change amount. Output: five independent risk axes
   (functionality/availability/scalability/performance/security) + `why` + confidence. This
   reuses phase-2's interpretation output directly, matching "diff folds into this algorithm."
6. **Inspect queue ranking** (`rank.ts`): one more LLM call (if ≤30 candidates) to order the
   queue by "what a human should look at first," not by `risk.score` — a final pass over the
   already-narrated deltas.

### Intended

Same shape as current — this phase already reuses the graph and the interpretation output
rather than recomputing anything independently. No architectural gap identified here.

### Gap

None found this session. Two smaller notes, not blocking:

- Pass D's risk narration currently reads a unit's `what`/`why` — if phase 2 gains
  callers/callees context (§2's plan), Pass D's risk narration inherits richer `why` fields for
  free, no changes needed to `pass-d.ts` itself.
- If §3's grouping step lands, blast-radius/rollup reporting could in principle roll up to
  `group` as well as to individual ancestors — not required, worth a one-line follow-up note
  once §3 ships, not part of this plan.

### Plan

No changes required to close phase 4 against stated intent. Flagged as verified-consistent, not
untouched-because-unexamined.

---

## 5. Summary — gaps and where each is tracked

| Phase | Gap | Severity | Tracked in |
|---|---|---|---|
| 1. Extraction | None (control-flow extraction is a separate, larger ask, out of scope here) | — | — |
| 2. Pass A | Graph structure (callers/callees) computed but never passed into the per-function LLM call, despite `analyze.md` already documenting this as intended | **Root cause candidate** for weak `where`/`why` semantics feeding everything downstream | This document, §2 — not yet in an implementation plan file |
| 3. Clustering/grouping | No super-grouping of layers into architectural groups; new step should use layer-to-layer edge weight, not just names/semantics | Directly caused this session's original "module grouping unsatisfactory" complaint | `~/.claude/plans/soft-bubbling-valley.md` (Part A), extended by this document's §3 refinement |
| 4. Diff | None found | — | — |

**Sequencing note:** §2 (Pass A context) and §3 (layer grouping) are independent — §3 does not
require §2 to ship first, since Pass B already gets structural edge data directly rather than
through Pass A. But shipping §2 first would improve every downstream `oneLiners`/layer-narration
input for free, so if both are being built, §2 first is the higher-leverage order.

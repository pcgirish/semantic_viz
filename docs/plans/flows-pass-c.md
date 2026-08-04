# Pass C: generate api_flow units (Flows view)

## Problem

`design.md` and `analyze.md` scope `api_flow` generation as part of **Pass C**
(architecture narration): "Layers, `api_flow` units (route handler → service → store,
traced along real edges), system-level `why`" (`analyze.md:48`). The UI (`Flows.tsx`,
`App.tsx` mode `"flows"`) is fully built and tested against hand-built fixtures, but
`packages/interpreter/src/pass-c.ts` only does layer narration — it never proposes entry
points or produces `api_flow` units. Real snapshots always hit the Flows view's empty
state.

Confirmed via the mock (`docs/mock/tools/build.py` + `docs/mock/tools/interpret.json`):
`api_flow` units carry `route`, `name`, and an ordered `steps: UnitId[]` traced through
the real call graph, plus LLM narration (`what/how/when/where/why/tags/confidence`).

## Design (per discussion)

Not a new pass — Pass C grows a second responsibility. Mirrors Pass B's
propose-then-deterministically-repair split, reusing Pass C's existing
per-item-narration-call shape:

1. **One LLM call — entry-point proposal.** Given all units' oneLiners (or Pass A
   `what` one-liners for leaf units, same input class as Pass B's file oneliners) plus
   the unit-level call-graph adjacency, the LLM proposes which units are flow entry
   points and a `name`/`route` guess for each. One call total, not per-cluster —
   structurally this is the Pass-B move (propose global structure in one shot).

2. **Deterministic tracer (no LLM) — new `traceFlow()` in `checker.ts`.** For each
   proposed entry point (validated against real unit ids — invented ids dropped, exactly
   like `checkAndRepairClusters` drops invented files), walk outgoing `calls` edges
   depth-first, always taking the **single longest path** to a leaf (no further outgoing
   calls; cycle-safe via a visited-set). Produces `steps: UnitId[]` that can never be
   hallucinated, since every hop is a real edge.

3. **One LLM call per traced flow — narration.** Same request/response shape as the
   existing per-cluster Pass C narration call (`what/how/when/where/why/confidence`),
   plus `tags`, given the ordered list of step qualnames/one-liners. Reuses
   `interpretJsonWithRetry` exactly as the layer-narration loop does.

Net new LLM calls: 1 (entry-point proposal) + 1 per detected flow — same order of
magnitude as today's per-cluster narration loop.

## Files

### New
- `packages/interpreter/src/prompts/pass-c-flows.ts`
  - `passCEntryPointsPrompt(units, callEdges)` — step 1 prompt. Input: unit
    qualname/kind/one-liner list + `calls` edges (unit-id pairs), similar shape to
    `passBPrompt`'s file+edges input. Output: `{ "flows": [{ "unit": "<qualname>", "name": "...", "route": "..." }] }`.
  - `passCFlowNarrationPrompt(route, name, steps: {qualname, what}[])` — step 3 prompt.
    Output: `{ what, how, when, where, why, tags: string[], confidence }` — same shape as
    the existing `passCPrompt` response, plus `tags`.

- `packages/interpreter/test/checker.test.ts` (extend existing file) — tests for the new
  `traceFlow()` export:
  - traces the single longest path from an entry unit through `calls` edges
  - stops at a leaf (no outgoing `calls` edges)
  - does not infinite-loop on a cycle (A calls B calls A)
  - branch: picks the longer of two branches, not the first-seen
  - unknown/invented entry unit id → returns `null` (dropped, not thrown)

- `packages/interpreter/test/pass-c-flows.test.ts` — new test file:
  - `proposeFlowEntryPoints()`: parses LLM response, drops invented unit ids (mirrors
    `checkAndRepairClusters`'s repair behavior)
  - `narrateFlow()`: builds request from traced steps, parses response into the
    `api_flow`-shaped narration object

### Edited
- `packages/interpreter/src/checker.ts` — add:
  ```ts
  export interface CallEdge { from: string; to: string; }

  /** Depth-first, always the longest branch, cycle-safe. Real edges only — steps can
   *  never be hallucinated because every hop is a validated edge in the graph. */
  export function traceFlow(entryUnitId: string, knownUnitIds: Set<string>, callEdges: CallEdge[]): string[] | null {
    if (!knownUnitIds.has(entryUnitId)) return null;
    const adjacency = new Map<string, string[]>();
    for (const e of callEdges) (adjacency.get(e.from) ?? adjacency.set(e.from, []).get(e.from)!).push(e.to);

    function longestFrom(id: string, visited: Set<string>): string[] {
      const next = (adjacency.get(id) ?? []).filter((n) => !visited.has(n));
      let best: string[] = [];
      for (const n of next) {
        const path = longestFrom(n, new Set([...visited, n]));
        if (path.length > best.length) best = path;
      }
      return [id, ...best];
    }
    return longestFrom(entryUnitId, new Set([entryUnitId]));
  }
  ```

- `packages/interpreter/src/pass-c.ts` — add alongside existing `runPassC`:
  - `proposeFlowEntryPoints(options): Promise<{unit: string; name: string; route: string}[]>` —
    calls `passCEntryPointsPrompt`, validates proposed unit ids against the known set
    (drop unknowns, mirrors `checkAndRepairClusters`).
  - `narrateFlow(options): Promise<{what,how,when,where,why,tags,confidence}>` — calls
    `passCFlowNarrationPrompt`.
  - Exported via `packages/interpreter/src/index.ts` alongside the existing `runPassC`
    export.

- `packages/interpreter/src/orchestrate.ts` — after the existing Pass C layer loop
  (`orchestrate.ts:130-159`), before the system unit is built:
  1. Build unit-level `calls` edges from `snapshot.edges` (already unit-level — no
     file-collapsing needed, unlike the existing `importEdges`/`layerEdgeWeight`
     aggregation which is file/layer-level).
  2. Call `proposeFlowEntryPoints` with all units' oneliners + call edges.
  3. For each proposed entry point, call `traceFlow`; skip if `null` or `steps.length < 2`
     (a "flow" of one unit isn't a flow).
  4. Call `narrateFlow` per traced flow.
  5. Push one `api_flow` unit per flow into `newUnits`, `id: u:flow:${sha1(route).slice(0,8)}`
     (mirrors the mock's `"u:flow:" + h(route, 8)` and the existing `layerIdFor` pattern
     of content-derived, not LLM-name-derived, ids), `parent: sysId`, `children: []`,
     `route`, `steps`, `loc.files`/`loc.sloc` derived from step units (mirrors mock lines
     87-89), `metrics.hops`, `hash.struct` from joined step ids.
  6. Add flow ids to the system unit's `children` alongside `layerIds`.

- `packages/interpreter/src/index.ts` — export `traceFlow`, `proposeFlowEntryPoints`,
  `narrateFlow` types/functions.

### Eval / fixture
- `packages/interpreter/eval/` (existing fixture corpus, per `implement-analyze.md:114`) —
  add expected `api_flow` output for the `orderly` fixture, based on
  `docs/mock/tools/interpret.json`'s `api_flows[0]` (`POST /public/orders`) as the known
  entry point (`fixtures/orderly/src/api/routes.py`'s `public.post("/orders")(...)` call).
  `scv eval` must not regress below whatever baseline this establishes.

- Bump `prompt_rev` (per `implement-analyze.md:112`: changing a prompt invalidates
  exactly the cache entries that depended on it) — this adds two new prompts under the
  same Pass C `prompt_rev`, so treat it as a Pass C prompt-rev bump.

## Non-goals (this change)

- No static route-decorator detection (FastAPI `@app.post`, Express `router.get`, etc.).
  Entry-point identification stays LLM-proposed from oneliners + call graph, per
  `analyze.md`'s explicit design ("Explicit `api_flow` units matched by route string,
  marked `source:"llm"`, `confidence<1`" — `design.md`'s risk table).
- No branching/multi-path `steps` (a flow with a conditional fan-out only records its
  longest branch). Flagged as a known simplification, not solved here.
- No changes to `Flows.tsx`/`App.tsx` — the UI already consumes `api_flow` units
  correctly; this only makes the pipeline actually produce them.

## Verification

1. TDD: `checker.test.ts` (traceFlow) and `pass-c-flows.test.ts` RED before
   implementation, GREEN after.
2. `npm test`, `npm run lint`, `npm run build` clean across the monorepo.
3. Run the real pipeline against `fixtures/orderly` (ollama provider, per project
   convention — no claude-cli unless explicitly asked) and confirm at least the
   `POST /public/orders` flow is detected with a non-trivial `steps` chain, then serve
   and check the Flows view renders it (Playwright, against the user's own dev server).
4. `scv eval` against `packages/interpreter/eval/` fixture corpus — no regression.

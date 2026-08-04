# Flowchart readability: semantic block labels, edge labels, sequential collapsing

## Context

Comparing a UI mock of `orders.createOrder()`'s flowchart against the current renderer
(`packages/ui/src/Flowchart.tsx` via `packages/layout/src/flowchart.ts` +
`packages/skins/tiles/src/{node,link}.ts`) surfaced five readability gaps:

1. Node labels are structural (`"sequential"`, `"merge"`, `"entry"`, `"exit"`, or raw
   condition source like `"not payload.ok"`) instead of semantic (`"validate payload"`,
   `"price items"`).
2. Decision edges show bare `T`/`F` glyphs instead of `yes`/`no`.
3. Straight-line code is one node per statement-run (`"sequential"`) instead of collapsed
   into one meaningfully-named step.
4. Merge/exit nodes carry no indication of what's actually returned/raised.
5. No header/context framing (function name, route, "unchanged baseline" annotation) above
   the diagram.

Traced the current pipeline: `SymbolBlock` (extractor, `walk-python.ts`/
`walk-typescript.ts` `BlockBuilder`) already records `startLine`/`endLine` for every
block including `sequential`/`merge`/`exit`, and `condition` (raw source) for
`decision`/`loop`. `resolveBlockGraph` (`resolve.ts:317-369`) turns these into
`SymbolBlockGraph` only for functions with actual branching. `orchestrate.ts:185-237`
turns each `SymbolBlock` into a `kind: "block"` Unit **right after Pass A, independent of
Pass B/C** (per existing comment at line 185-186) — `name: block.condition ?? block.blockType`
is the current (weak) label. Block units are never touched by any interpreter pass today.
Since source spans are already captured and Pass A's source text is already fetched at
that point in the pipeline, semantic labeling is a small additional LLM step, not a new
pass with new infrastructure.

## Plan

**1. New interpreter step: Pass A-blocks (semantic block labels).**
New file `packages/interpreter/src/pass-a-blocks.ts`, modeled on `pass-a.ts`. One call
**per function** (not per block) — batch all of a function's blocks into a single prompt
listing each block's id, type, and source span text (sliced from the already-available
function source), ask for a short imperative label per block (`"validate payload"`,
`"price items"`, `"persist order (db)"`) plus, for `exit` blocks specifically, a
result-facing label derived from the `return`/`raise` statement text (`"return 400"`,
`"rollback + 402"`, `"emit confirmation · 201"` if a status code is inferable from source,
else a plain summary). Zod response schema: array of `{ blockId, label }`. Skip decision
blocks needing a full rewrite — reuse existing `condition` text but ask the model for a
short question form too (`"valid?"` from `"not payload.ok"`) since that's the same call
and same source context. Cache like Pass A (`CachedProvider`, keyed on block id set +
function source hash).
Wire into `orchestrate.ts` immediately after the existing block-materialization loop
(~line 237): for each function with a non-empty `bg.blocks`, call the new step, then set
`name` from the returned label instead of `block.condition ?? block.blockType`
(fall back to current behavior if the LLM call fails — never block the whole run on this).
Test: mock provider, assert block units get semantic names; assert fallback to
`blockType` on provider error.

**2. Edge labels: yes/no instead of T/F.**
`packages/skins/tiles/src/link.ts:21-27`, `FLOW_LABEL` map: `true: "yes"`, `false: "no"`
(keep `loop-back`/`exception` glyphs). No LLM, no schema change. Test: existing link
rendering test, update expected label text.

**3. Collapse consecutive sequential blocks into one node.**
`packages/layout/src/flowchart.ts`: before ranking, merge any run of `sequential` blocks
connected by a single in/single out `sequential` edge into one logical node (keep the
first block's id as the merged node's id, union the source span for the label lookup).
This changes what Pass A-blocks (step 1) should label — label the *merged* span, not each
original micro-block, so do step 1's prompt construction after this collapsing decision is
implemented (collapsing is deterministic/structural, done first; then step 1 batches one
label per post-collapse node). Test: function with 3 sequential statements in a row —
assert one node in the scene, not three.

**4. Exit/merge node result labels.**
Covered by step 1 (exit blocks get a result-facing label in the same batched call). No
separate pass. Merge nodes: leave structural (no semantic content to summarize — they're
control-flow joins, not decisions or actions); mock's clean look comes mostly from step 3
collapsing removing the redundant merge nodes that sit right before a single exit.

**5. Header/context framing above the diagram.**
UI-only, static, no LLM. `packages/ui/src/Flowchart.tsx`: render a small header above the
`<svg>` using data already on `functionUnit` (qualname, and — if available — an inferred
route from `api_flow` units/edges already in the snapshot; else omit that line). No new
data needed.

## Verification

- `npm run lint && npm test` after each step.
- Step 1: run `scv analyze` on `fixtures/orderly`, inspect `create_order`'s block units in
  the snapshot JSON — labels should read like the mock, not `"sequential"`/`"merge"`.
- Step 3: same fixture — confirm `create_order`'s flowchart node count drops (fewer
  `sequential` nodes) while branching structure is unchanged.
- Manual: open the UI, drill into `create_order`, visually compare against the mock
  screenshot.
- TDD throughout per CLAUDE.md: failing test before implementation, each step.

## Out of scope

- Everything in the previously-scoped `docs/plans/review-reconciliation-security-and-correctness.md`
  and `pass-a-graph-context-and-cheaper-passes.md` plans — unrelated, not touched here.
- Full tool-calling/agentic passes — rejected in the existing plan's reasoning, still
  applies; this is a small batched call per function, same shape as Pass A.
- TypeScript-side block extraction changes — `walk-typescript.ts`'s `BlockBuilder` already
  mirrors the Python one per its own doc comment; no changes needed there beyond what step
  1 consumes generically via `SymbolBlock`.

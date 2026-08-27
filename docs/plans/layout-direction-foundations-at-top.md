# Fix dependency-graph layout direction (foundations at top)

## Context

`scv`'s dependency-graph views (top-level layer graph, group drill-down, file-cluster drill-down) render foundational/high-fan-in modules (e.g. `config.py`, `constants.py`) at the **bottom** of the canvas, with arrows converging downward into them. This is technically correct (`edge.from`=importer, `edge.to`=imported, arrowhead at `edge.to`) but reads backwards to users, who expect foundation/root modules at the top and dependents flowing down — the standard flowchart convention. A user flagged this as looking like "constants depends on everything" when the reverse is true. Confirmed via code + git history this is not a regression — it's how the layout has always worked; it's a UX defect, not a data bug.

Root cause: `rank()` in `packages/layout/src/rank.ts` assigns rank 0 to nodes with no incoming edges (entry points) and increases rank along the import chain, so foundational modules get the highest rank. `place.ts` maps row order directly to row index, so rank 0 → row 0 → top of canvas. Net effect: entry points at top, foundations at bottom.

## Approach

Keep `rank()` semantics unchanged (it's reused by `expand.ts`/`order.ts`, and rewriting cycle-breaking there is unnecessary risk) and keep every `SceneLink`'s logical `from`/`to` unchanged (still caller/importer → callee/dependency; no data or extractor change). Only the **screen** direction flips: which row renders at the top, and which physical edge of each box each port sits on. This is a layout-orientation change, not an edge/arrow reversal — the arrowhead still attaches to `to` via `markerEnd` (`ConnectorLayer.jsx`), so its rendering *behavior* needs no change. Its `orthoPathVertical()` doc comment does need a documentation-only edit (see Out of scope) since it currently describes the pre-flip direction.

The behavioral change is confined to `packages/layout/src/place.ts` and `packages/layout/src/route.ts`, plus stale direction comments in `packages/ui/src/CanvasHost.tsx` and `ConnectorLayer.jsx` (doc-only, no logic change in either). It applies uniformly to every consumer of `buildScene()`: `CanvasHost.tsx` (2D), `Canvas3dHost.tsx` (3D — a second, independent `buildScene()` call), and `nested.ts`'s `nestedScene()` (drill-down thumbnails, which call `buildScene()` fresh and then fit-scale the result — inherits the fix automatically, but must be verified since it's a separate render path).

**The Flowchart view (control-flow inside a function) must NOT change.** It uses its own `buildFlowchartScene()` / `rankBlocks()` in `packages/layout/src/flowchart.ts` — a completely separate function with its own placement logic, sharing no code path with `place.ts`/`route.ts`. It already reads correctly top-to-bottom (entry block at top) because it represents control flow, not import direction, and inverting the dependency-graph pipeline must have zero effect on it. Verify this explicitly during implementation and testing — do not touch `flowchart.ts`.

### 1. `packages/layout/src/place.ts`

`place(rows, sloc)` currently iterates `effectiveRows` in order and stacks `y` downward starting at 0 (line 36: `let y = 0`; loop at 37-48). Reverse the row iteration order so the last row (highest rank, most foundational) lands at `y=0` and earlier rows (entry points) stack below:

```ts
const orderedRows = [...effectiveRows].reverse();
let y = 0;
for (const row of orderedRows) {
  ...
}
```

No other logic in the function changes — box sizing, x-centering, and row wrapping (`wrapRow`) are rank-order-agnostic. Update the `ROW_GAP` comment (line 9, currently "room for the ortho-v elbow to read clearly as a vertical drop + jog + vertical drop") to not imply a fixed downward direction — the elbow now reads as a vertical *rise* + jog + vertical rise for a cross-rank edge.

Test impact (`packages/layout/test/place.test.ts`): reviewed all cases — every multi-row assertion uses relative comparisons (`toBeGreaterThanOrEqual`) between generically-named boxes, not row semantics, so they remain valid after reversal. No test changes required. However, these tests only assert geometry (no overlap, correct stacking order) — none of them tie row order to dependency direction, so they cannot catch a regression in *which* end is foundational. Add a new semantic test (new file or a `describe` block in `packages/layout/test/layout.test.ts`, since it needs `buildScene`, not raw `place`): given a two-node graph `caller → callee` (`callee` has the incoming edge), assert `callee.y < caller.y` after `buildScene()`, and assert the routed `SceneLink`'s path starts at `caller`'s top port and ends at `callee`'s bottom port — i.e. lock in the *meaning* of the new orientation, not just its internal consistency.

### 2. `packages/layout/src/route.ts`

`spreadPorts` (lines 50, 68-69) assigns out-ports to a box's bottom edge (`box.y + box.h`) and in-ports to its top edge (`box.y`), assuming edges flow downward. Since foundational nodes now render above their dependents, edges flow *upward* on screen from importer to imported. Swap the two:

```ts
const outPortByIndex = assign(outByNode, (box) => box.y);
const inPortByIndex = assign(inByNode, (box) => box.y + box.h);
```

Out-ports now on a box's top edge, in-ports on its bottom edge — matching the new upward flow direction while preserving port semantics (out = where this node's outgoing/dependency edges leave; in = where incoming/dependent edges arrive). Update the function-level comment above `spreadPorts` (line ~23, "A node's out-edges fan across its bottom border, in-edges across its top") to match.

Test impact (`packages/layout/test/route.test.ts`): update any hardcoded y-edge assertions that encode the old top/bottom assumption. Also add a case for a multi-rank edge that passes through a dummy waypoint (from `expand.ts`): after inversion, its path must still run caller-below to callee-above in order, without any segment cutting back through a node box — i.e. the waypoint ordering itself doesn't need touching, but the geometry it produces post-flip needs a regression test since nothing today pins that shape.

`CanvasHost.tsx` (~lines 90-125) computes `route: "ortho" | "ortho-v"` and `clearY` purely from `start.y === end.y` / `(start.y + end.y) / 2` — direction-agnostic, no code change needed. Its comment at ~line 106 ("entering the node face at 90deg top/bottom") should be checked and reworded if it implies a fixed source-bottom/target-top assumption, since which face is now "in" vs "out" has flipped.

### 3. `packages/ui/src/Legend.tsx` — directional cue

In the existing "Connectors" section (~line 217-253, inside the `showNav` block, after the "imports" line-style entry), add a short explicit direction note:

```tsx
<div style={{ font: "var(--text-xs)", color: "var(--text-dim)", lineHeight: 1.6, marginTop: 4 }}>
  A → B: A depends on B (B renders above A)
</div>
```

No new component or state — just an addition to existing rendered markup, matching the section's current style tokens (`--text-xs`, `--text-dim`).

## Explicit screen convention

After this change: **A → B means A depends on B; B (the dependency) is drawn above A (the dependent).** The underlying edge (`SceneLink.from`/`to`, extractor data, `Inspector.tsx`'s "Depends on"/"Used by") is untouched — only where each rank renders on screen and which box face each port sits on. Do not swap `from`/`to`, do not reverse `SceneLink.path` order, do not mutate snapshot edges. Reversing the rendered endpoint order would falsely communicate `callee → caller` and break inspector, hover, roll-up, and clustering semantics that all key off the existing `from`/`to` meaning.

## Out of scope / unaffected

- `rank.ts`, `expand.ts`, `order.ts`, `seed.ts`, `layout.ts` — untouched; rank semantics and orchestration are unchanged.
- `flowchart.ts` / `buildFlowchartScene()` / `rankBlocks()` — fully independent control-flow layout, no shared code path with `place.ts`/`route.ts`. **Not touched, and must be verified unaffected — no flip applied to flowchart placement.**
- `Inspector.tsx` — edge data unaffected, not touched.
- `ConnectorLayer.jsx` — `markerEnd` attaches to the path's `to` endpoint regardless of screen position, so arrowhead behavior needs no change. Its `orthoPathVertical()` doc comment currently reads "bottom-of-source to top-of-target" / "leaves straight down" — **this must be updated** to match the post-flip direction (source-top to target-bottom), even though the function's geometry itself (takes explicit `x1,y1,x2,y2,clearY`) needs no code change.
- Extractor/schema/snapshot edge data — no change; this is purely a rendering-layer flip.

## Verification

1. TDD: run `packages/layout` tests before changing code to confirm current baseline, then after the `place.ts`/`route.ts` edits (`npm run test -w packages/layout` or repo's standard test command).
   - `place.test.ts`: expected to pass unchanged (geometry-only assertions).
   - `route.test.ts`: update any hardcoded y-edge assertions that assumed out=bottom/in=top; add the dummy-waypoint multi-rank case described above.
   - Add the new semantic orientation test via `buildScene()` in `layout.test.ts`, asserting the full rendered contract for `caller → callee`: `caller.y > callee.y`; the routed `SceneLink`'s path starts at the caller's **top** border and ends at the callee's **bottom** border; and `to` still equals `callee` (so `markerEnd` remains anchored at the callee regardless of screen position).
2. Run `packages/layout/test/flowchart.test.ts` specifically and confirm it is untouched/still green — direct evidence the flowchart path did not flip.
3. `npm run lint` and `npm run build` across the repo.
4. Verify all three `buildScene()` consumers render the flip correctly, since each is a separate render path even though they share the same layout data:
   - `CanvasHost.tsx` (2D) — primary manual check.
   - `Canvas3dHost.tsx` (3D/cityscape skin) — confirm foundational nodes render at the top in the 3D view too, not just 2D, **and** confirm arrow direction reads correctly in the 3D world/camera presentation (a separate check from node ordering, since the 3D host's presentation layer differs from 2D's).
   - `nested.ts`'s `nestedScene()` (group/cluster drill-down thumbnails) — confirm the fit-scaled thumbnail preserves the same top/bottom orientation as its full-scale parent.
5. Manual end-to-end: run `scv ui` against the already-analyzed `eq_to_word_problem` repo (existing artifacts at `.scv/artifacts/c5ee733e4864ca3171783cd1b94df631a1cb7d06`), reload, and check:
   - Top-level graph: foundational/high-fan-in layers (e.g. Backend Constants) render near the top, not bottom.
   - "Backend Domain" group drill-down and any file-cluster drill-down view: same top-down foundation ordering.
   - Arrows still point from importer toward the imported module (visually now pointing upward/toward top rows) — verify via hover/Inspector that "Depends on"/"Used by" still match the pre-fix semantics exactly.
   - Legend sidebar shows the new "A → B: A depends on B (B renders above A)" cue.
   - Flowchart view (double-click a branching function): still top-down control flow, entry block at top, unaffected by the dependency-graph change.

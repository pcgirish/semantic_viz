# Canvas pan/zoom

**Status:** closed (pan/zoom/fit) — layout-axis change still open
**Found:** 2026-08-08
**Closed:** 2026-08-20

## Problem (as originally filed)
CanvasHost had no pan or zoom — the graph rendered at fixed scale/position.
Deferred explicitly during the Current-mode domain-grouping work (PR #80)
alongside item 4 (left-to-right layout axis change); grouping was resolved
first, this and the layout-axis change remained outstanding.

Larger systems (or drilling into a domain with many members) would run off
the visible canvas with no way to navigate except drill/ascend.

## Resolution
Navigation shipped in two steps:

- **Pan and zoom** — mouse-wheel zoom (cursor-anchored, clamped to
  `MIN_SCALE`/`MAX_SCALE`) and click-drag pan, both on the `.canvas-scale`
  transform wrapper in `packages/ui/src/CanvasHost.tsx`. The wheel listener is
  registered non-passively because React attaches synthetic `onWheel` as
  passive, which silently drops `preventDefault()` and lets Firefox fall
  through to native zoom.
- **Initial fit-to-content** — the last remaining gap, closed in PR #112. A
  layout effect measures the scroll viewport and fits the scene into it on
  every scene change (keyed on scene identity, not object identity, so a
  re-render does not discard the user's zoom). Capped at 1 so a two-tile
  scene is not blown up to fill a large screen.

No minimap was built; `packages/layout` already emits recursive mini-maps and
nothing has needed one at the canvas level yet. Reopen if large graphs prove
otherwise.

## Still open — left-to-right layout axis
The companion item from PR #80 has **not** shipped. `packages/layout/src/place.ts`
still places one row per rank and stacks rows downward, so cross-rank flow reads
top-to-bottom. (The "left-to-right" comments in `place.ts`, `route.ts`, and
`flowchart.ts` describe ordering *within* a rank, not the rank axis itself.)
Tracked here rather than in its own file because the two were filed together.

## Affected
- `packages/ui/src/CanvasHost.tsx`
- `packages/design-system` GraphCanvas component
- `packages/layout/src/place.ts` (axis change, still open)

# Canvas pan/zoom

**Status:** open
**Found:** 2026-08-08

## Problem
CanvasHost has no pan or zoom — the graph renders at fixed scale/position.
Deferred explicitly during the Current-mode domain-grouping work (PR #80)
alongside item 4 (left-to-right layout axis change); grouping was resolved
first, this and the layout-axis change remain outstanding.

Larger systems (or drilling into a domain with many members) will run off
the visible canvas with no way to navigate except drill/ascend.

## Fix direction
Not yet scoped. Likely candidates: CSS-transform-based pan/zoom on the
GraphCanvas wrapper, mouse-wheel zoom (note: a Firefox wheel-zoom fix
already landed in PR #79 for something adjacent — check for reuse),
click-drag pan, possibly a minimap for large graphs.

## Affected
- `packages/ui/src/CanvasHost.tsx`
- `packages/design-system` GraphCanvas component

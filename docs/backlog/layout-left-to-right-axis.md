# Layout: left-to-right rank axis

**Status:** open
**Found:** 2026-08-08 (filed alongside `canvas-pan-zoom.md`, PR #80)

## Problem
`packages/layout/src/place.ts` places one row per rank and stacks rows
downward, so cross-rank flow reads top-to-bottom. The original PR #80 ask
was a left-to-right layout axis (ranks as columns, not rows) — deferred
alongside canvas pan/zoom, which has since shipped (see
`docs/backlog/canvas-pan-zoom.md`). This axis change was never split into
its own tracking item and had no visibility outside that file.

The "left-to-right" comments already present in `place.ts`, `route.ts`, and
`flowchart.ts` describe ordering *within* a rank, not the rank axis itself
— easy to misread as evidence this already shipped.

## Affected
- `packages/layout/src/place.ts` (rank axis)
- `packages/layout/src/route.ts` (edge routing depends on axis)
- `packages/ui` flowchart/graph rendering consuming layout output

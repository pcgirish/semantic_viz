# Temperature scale: confidence rendered as risk, legend shown where nothing reads it

**Status:** open
**Found:** 2026-08-27 (while reviewing the Legend during the connected-siblings tray work)
**Filed here:** 2026-08-27

## Problem
Two related defects around the eight-stop temperature ramp
(`packages/design-system/components/viz/temp.js`), one visual-correctness and one
documentation.

### 1. `RiskMeter` is fed confidence, not risk (the real defect)
`packages/ui/src/Inspector.tsx:187`:

```tsx
<RiskMeter value={unit.semantics.confidence * 7} label={`confidence: ...`} />
```

`RiskMeter` colours itself with `tempHex(value)` — the same `Dormant → Critical`
ramp the Legend documents. So confidence is painted on a risk axis, and the
mapping is inverted against its meaning: a **high**-confidence unit (the good
outcome) renders `--temp-7` critical red, a low-confidence one renders cool.

The label reads "confidence: 92%" beside a bar the palette says means "critical".
This is the only temperature consumer in the Inspector, and the Inspector renders
in **every** mode, so the wrong encoding is on screen in Current as well as Delta.

Fix is a judgment call, not obvious:
- feed `RiskMeter` the unit's actual risk score and surface confidence some other
  way, or
- give `RiskMeter` a neutral/scalar palette for non-risk values, keeping the temp
  ramp for genuine risk.

### 2. `showTemp` includes Current, where nothing reads the ramp
`packages/ui/src/Legend.tsx:59` gates the Temperature-scale section on
`mode === "current" || mode === "delta"`.

In **Delta** the section is correct and load-bearing: `InspectQueue.tsx:38` passes
`temp={Math.round(e.risk * 7)}` into `FileRow`, which calls `tempHex` — a real
continuous map from risk onto those stops, on Delta mode's primary interface
(docs/serve.md#4).

In **Current** nothing does. Tile hue is the hashed layer palette
(`CanvasHost.tsx:302-304` records why: `SceneNode.heat` is hardcoded to 0 at
`layout.ts:214` and `flowchart.ts:162`, and nothing reads it back). Delta's tile
encoding is discrete status *outlines* (`--temp-2/4/6` for added/changed/removed
in `skins/tiles/src/node.tsx:30-41`), not positions on the ramp — so a reader
matching the continuous bar against those outlines infers a severity ordering the
tiles are not expressing.

## Ordering
These interact — do not gate the legend first. `showTemp = mode === "delta"` on
its own would *hide the key* to defect 1 rather than fix it, leaving the Inspector
painting a temp ramp in Current with nothing on screen to decode it. Fix
`RiskMeter`'s input first; the gating change is clean only once Current no longer
renders a temperature ramp at all.

## Also worth deciding
- A Delta-mode **status key** (added / changed / removed swatches) is missing
  entirely, while the decorative ramp sits above it. Delta's actual tile encoding
  is currently undocumented in the legend.
- `RiskRadar.jsx` also calls `tempStop`/`tempHex`, but no UI package imports it —
  design-system-only today. Confirm before treating it as a consumer.

## Not in scope of
PR #161 (connected-siblings tray). Found during that work; deliberately left
untouched there.

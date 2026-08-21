# Fix 3D-skin navigation and scale gaps

## Context

User feedback on the cityscape/tiles3d work (Wave 5, branch `feature/cityscape-skin`), refined after driving the app:

1. **Cityscape navigation is broken in two reported ways:**
   - a) Dragging in fly mode only moves you *away* — hard to reverse/control. Root cause confirmed in source (Phase 1, Bug B).
   - b) The minimap's heading compass spins continuously in one direction regardless of which way the user actually turns. Root cause **not** yet found — the obvious suspect (minimap rotation sign) was investigated and ruled out; likely a symptom of (a). See Phase 1, Bug A.
2. Expected continuous camera zoom to substitute for click-to-drill — zooming into a block should organically reveal its parts.
3. `fixtures/orderly` (6 layers) is easy to read; a real repo like `../eq_to_word_problem` (15+ layers) is not.

#1 turned out to be real bugs in the control layer, not a design/spec gap — found by reading `controls3d.ts`, three.js's `FlyControls`, and the minimap projection directly. #2 and #3 remain genuine gaps between design intent (`docs/serve.md`, `docs/implement-serve.md`) and what shipped; #3 is explicitly flagged in `docs/implement-serve.md` as an unresolved open question. Fix the control bugs first (cheapest, highest-confidence), then the design gaps.

**A caution this plan earned the hard way:** the first pass at #1b diagnosed a rotation-sign error and "fixed" it by negating the minimap angle. The maths was checked afterwards and the negation was *wrong* — it broke east/west while leaving the north/south cases (where the sign is degenerate) looking correct. Verify a directional fix against all four cardinals, and prefer tests that derive expectations independently of the implementation's own formula.

## Phase 1 — Fix the cityscape navigation bugs

**Bug A: compass spins one direction regardless of actual turning.** Root cause **not yet
identified** — the minimap's rotation maths was the obvious suspect and has been ruled out.

An earlier diagnosis held that SVG's clockwise-positive rotation opposes the heading's
convention, so `Minimap.tsx:61` needed its angle negated. That is wrong, and the negation
actively introduces a bug. `minimapProjection`'s `toMap` maps world **+z → screen +y** with no
vertical flip (`packages/skins/cityscape/src/minimap.ts:75-76`). That y-down mapping already
absorbs the handedness change, so `heading = atan2(dir.x, -dir.z)` (`Canvas3dHost.tsx:141`)
composes correctly with `rotate()` exactly as written.

Checking the wedge apex direction against the camera's facing for all four cardinals:

| Facing | Current code | Negated |
|---|---|---|
| north (-z) / south (+z) | correct | correct — degenerate at 0°/180° |
| east (+x) | correct | **points west** |
| west (-x) | correct | **points east** |

North and south sit where the rotation sign cannot matter, which is what makes the wrong fix
look plausible if only those are checked. **Do not negate the angle.**

Where to look instead: the most likely cause is the same rate-based `FlyControls` rotation
behind Bug B — while a drag is held the camera genuinely spins continuously, and the compass
is faithfully reporting it. Fix Bug B first, then re-check the compass in the browser; it may
need no change at all. Only if the spin persists in walk mode (which uses
`PointerLockControls`, not `FlyControls`) is there a second, separate bug to find.

**Closed — Bug A was a symptom of Bug B, and the minimap needed no change.** Re-checked in a
browser against `fixtures/orderly` after the Bug B fix landed. From a clean camera, four exact
90° left turns:

| Facing | Wedge apex |
|---|---|
| north (-z), start | up |
| west (-x) | left |
| south (+z) | down |
| east (+x) | right |
| back to north | up |

All four cardinals correct, sweeping counter-clockwise for left turns, and returning exactly to
the start after 360°. The "spins continuously in one direction" report was the compass honestly
tracking a camera that really was spinning.

**Bug B: dragging in fly mode only moves away, hard to reverse.**

Root cause: `packages/ui/src/Canvas3dHost.tsx:178` selects `flyControls` for cityscape's non-street ("Fly") view. `flyControls` (`packages/ui/src/controls3d.ts:42-48`) wraps three.js's stock `FlyControls` with `dragToLook: true`. The problem is how that controller reads the pointer:

- `FlyControls.onPointerMove` sets `yawLeft`/`pitchDown` from the cursor's **absolute offset from the canvas centre**, normalised by half-width/half-height — *not* from a drag delta.
- `update()` applies those as a per-frame rotation **rate** (`rotMult = delta * rollSpeed`).

So while the button is held, the camera rotates continuously at a speed proportional to how far the cursor sits from centre, and never settles. Dragging back toward centre only *slows* the spin — it does not unwind it. There is no cursor position that returns the camera to where it started, which is exactly the reported "only moves away, hard to reverse." (`onPointerUp` does zero the rotation, so it stops on release.)

Two claims in the earlier diagnosis were wrong and are worth recording: `autoForward` is **never set** and defaults to `false`, so the camera does not drift forward on its own; and drag changes *orientation* only, never position.

Two candidate fixes:
- **A. Swap the fly-mode default to a delta-based drag controller** — `OrbitControls` is already imported (`controls3d.ts:2`) and moves by drag delta, so a gesture and its reverse cancel. Matches the user's "drag reverses drag" expectation.
- **B. Keep `FlyControls` but replace its absolute-position look with a delta-based one** — means patching around three.js's pointer model in our wrapper.

Recommend **A**: less code than fighting the stock controller, and it is the model the user already expects. Confirm in-browser before committing.

**Tests (RED first).**

`packages/ui/test/Minimap.test.tsx` pins the wedge direction: assert the apex points the way the camera faces for **all four cardinals**, deriving the expected direction independently of the implementation's formula. Asserting the `rotate()` string against that same formula proves nothing — it passes with either sign — and north/south alone are degenerate, so east/west are what discriminate. This test fails on the negated code and passes on the current code.

For Bug B, whichever control replaces `flyControls`: a `controls3d` unit test asserting drag-then-reverse-drag returns the camera toward its starting **orientation** (bounded by tolerance). Assert on orientation, not position — fly-drag never translates the camera, so a position-based assertion would pass vacuously.

## Phase 2 — Occlusion & beacon visibility (secondary navigability gap)

**Problem.** `docs/serve.md:187-192` requires non-focused buildings render translucent *and* high-risk units project a beacon that "cannot be hidden behind the thing you do not [need to see]." Current `applyFocus` (`packages/ui/src/scene3d.ts:91-113`) only dims material opacity to 0.35 — it does not reorder the render/Z order, so a faded building can still visually occlude the focused one or a beacon behind it.

Note that beacon *fading* is already handled: `applyFocus` only touches the mesh named `"body"` (`scene3d.ts:96`), and the beacon is a sibling mesh named `"beacon"` (`packages/skins/tiles3d/src/node.ts:107-114`), so beacons are never dimmed today. The gap is render order alone — confirm that in the browser before writing a test for a fading bug that does not exist.

**Fix.**
- `packages/ui/src/scene3d.ts`: in `applyFocus`, when a focus is set, move the focused building's `THREE.Group` to the end of `root.children` (`root.remove(child); root.add(child)`) so it draws last / on top.
- If beacons do turn out to need an explicit exemption, match on the existing `mesh.name === "beacon"` rather than adding a parallel `userData.isBeacon` flag — the name is already the identifying convention for these child meshes.
- Minimap: add `risk?: number` to `MinimapNode` in `packages/skins/cityscape/src/minimap.ts` so `packages/ui/src/Minimap.tsx` can render a marker for risk ≥ 0.5, giving occlusion-proof wayfinding from the overhead view too.

**Tests (RED first).** `packages/ui/test/scene3d.test.ts` (or new): `applyFocus` — focused group ends at top of children order. A beacon-never-dims test is worth keeping as a regression pin even though it passes today. `packages/skins/cityscape/test/minimap.test.ts`: risk field passed through projection.

**Closed.** Both halves landed and were browser-verified against `fixtures/orderly`. Three notes
that change what came after:

1. **Render order was the smaller half.** The problem statement above named draw order as the
   whole gap; it is not. A faded mesh kept `depthWrite` on, so it still wrote into the depth
   buffer and punched a hole straight through the focused building behind it — reordering alone
   leaves that hole. The fix is both: `depthWrite = !faded`, *and* re-appending the focused
   child. Verified discriminating by temporarily reverting each in a built bundle and
   re-shooting the same focused view.
2. **Risk uses the boolean `ring`, not a numeric threshold.** The fix bullet above proposed
   `risk?: number` with a `≥ 0.5` cutoff in the UI. Implemented instead as `risk: boolean` read
   from the same `ring` flag `tiles3d` grows its beacon from (`node.ts:144`). A second threshold
   in the UI could drift out of step with the 3D view, and the map disagreeing with the city
   about what is flagged is worse than either alone.
3. **The risk channel has no producer.** `ring` is hardcoded `false` at both layout sites
   (`layout.ts:174`, `flowchart.ts:163`), as is `heat: 0`. So no fixture can currently show a
   beacon *or* a map marker — the encoding `docs/serve.md:187-192` specifies is unreachable
   end to end. The marker's render path is pinned by unit tests, but it cannot be seen in the
   browser until something computes risk. **Out of scope for this plan** — it is an
   analyze/layout gap, not a navigation one — but it should get its own issue, because Phase 2's
   beacon work is dormant until then.

## Phase 3 — Continuous zoom triggers drill/ascend

**Problem.** The user's ask ("zoom in, and it breaks apart") requires camera distance to drive navigation. Today navigation is discrete: click = select, dblclick = drill (`packages/ui/src/Canvas3dHost.tsx:253-270`), raycast-based only. `Scene` (`packages/layout/src/scene.ts`) is deliberately flat with no parent/child field — drilling swaps which flat Scene is loaded, server/store-side. So true geometric LOD isn't there to reveal; the practical fix is to auto-fire the *existing* discrete drill/ascend intents once the camera crosses a distance threshold, reusing the current `navigate()` machinery rather than building a new LOD data model.

**Fix.**
- `packages/ui/src/Canvas3dHost.tsx`: in the existing per-frame camera-tracking loop, after controls update, compute distance from camera to the currently-focused (or nearest) building's centroid.
  - `dist < DRILL_DISTANCE` (e.g. 150 units) and not already auto-drilled → call the same `drill(unitId)` store action dblclick uses.
  - `dist > ASCEND_DISTANCE` (e.g. 400 units) and currently auto-drilled → call `ascend()`.
  - Track state in a ref (`autoFiredRef`) so the two thresholds form a hysteresis band and don't flicker at the boundary; reset the ref on manual focus change or scene rebuild.
  - **Cityscape only.** `tiles3d` uses `OrbitControls`, where camera distance *is* the zoom affordance — auto-drilling on distance would hijack scroll-zoom and make the orbit view impossible to inspect closely. Gate on `skin === 'cityscape'`; this is settled, not an open question.
- No changes to `packages/layout` or `Scene` — this stays entirely in the UI host, consistent with "skin owns navigation, layout owns positions."

**Tests (RED first).** Distance/hysteresis state machine as a pure function (extract `computeAutoNavIntent(distance, state) -> 'drill'|'ascend'|null` so it's unit-testable without a live Three.js scene) in `packages/ui/test/`. Integration: auto-drill calls the same store action as dblclick.

## Phase 4 — Building shape legibility at street level

**Not a missing mapping — a legibility gap.** The height/shape/complexity relationship the user asked about already exists and is implemented correctly:

- **Height** = `sloc`, via `n.depth` (`docs/serve.md` extrusion-depth channel) — read directly from the layout-computed field in `body()`, `packages/skins/tiles3d/src/node.ts:87-104`. `body()` consumes `n.depth` raw, with no further scaling (confirmed: line 88, `const height = n.depth`).

**Sub-issue: raw sloc makes height too jarring.** `docs/serve.md#2` already establishes that raw `sloc` is too skewed for a direct visual channel — `area` is explicitly "√-scaled so a 500-line module does not erase a 20-line one," and extrusion depth "reuses the area channel deliberately." But nothing currently applies that same compression to `depth`: a 2000-line file would stand ~40x taller than a 50-line one linearly, which would flatten the rest of the skyline into visual noise around one or two skyscrapers. Fix belongs in the **layout engine**, not the skin (`docs/serve.md#1`'s "if a skin ever needs to move a node, the encoding belongs in the layout engine instead" — extrusion depth is exactly this kind of shared encoding value, and both `tiles3d` and `cityscape` read it unchanged).
  - Apply the same compression already used for `area` (√-scale) to the sloc value that feeds `depth`, or a log-scale if √ still leaves excessive spread above a threshold (e.g. very large generated files) — pick whichever keeps typical-file heights legibly separated without one outlier dominating the skyline. `depth` is computed by `depthFor()` in `packages/layout/src/layout.ts:38-42` (`MIN_DEPTH + sloc * DEPTH_PER_SLOC`); `area`'s √-scale lives separately in `packages/layout/src/place.ts:26-28`.
  - **Hard constraint — do not regress Checkpoint 2.** `MIN_DEPTH = 40` / `DEPTH_PER_SLOC = 3` were not chosen in the abstract: they were tuned *against the 96-wide footprint* so a median unit stands taller than it is wide, which is what stopped the street view reading as "a plain of slabs" (`layout.ts:27-39` comment; `docs/plans/wave-5-checkpoint-2-wayfinding.md` §3). Any new curve must be re-derived against that same footprint and satisfy: **a median-sloc unit is still taller than its footprint is wide.**
  - Note when deriving: `place.ts:28` clamps footprints at `MIN_DIM = 96`, so on `fixtures/orderly` most tiles sit at that floor and width barely varies. The `area` √-precedent this phase cites is therefore largely inert on that fixture — compressed heights will be compared against a near-constant width, so judge the curve on a repo with real sloc spread, not on orderly alone.
  - Keep a sensible minimum height so trivial files remain visible as buildings, not slabs.
  - This does not change what "height means" (`docs/serve.md`'s "encoding" rule) — sloc is still the sole driver of height, only the scale curve changes, mirroring the precedent already set for `area`.

**Tests (RED first, layout).** `packages/layout` unit test: given two sloc inputs differing by e.g. 40x, resulting `depth` values differ by a bounded, sub-linear ratio; monotonic (more sloc always taller); minimum-height floor holds for near-zero sloc. Plus a **Checkpoint 2 regression pin**: a median-sloc unit's `depth` exceeds `MIN_DIM` (96), so the compression can never silently reintroduce the slab problem.
- **Shape (footprint sides)** = cyclomatic complexity, bucketed to 4 legible steps (triangle/square/hexagon/cylinder) per `docs/serve.md`'s "not discriminable past six sides" rule — built by `ngonShape()`, `node.ts:36-48`, with circumradius scaling so a triangle still spans the full tile footprint rather than reading as a spike.
- **13+ complexity** ("look at this") extrudes to a **cylinder**, deliberately not a sphere, so it keeps reporting height/sloc (`docs/serve.md`'s explicit reasoning, `node.ts:92-94`).
- **Hue** = layer; **risk beacon** (cone) floats above roofline for high-risk units, a channel not otherwise spent (`node.ts:107-114`).

**An inversion was suspected here and ruled out.** Buildings appeared, from a street-level
screenshot, to stand on their apex — widest at the roofline, tapering to a point. They do not.
`body()` spans y=0 to y=`depth` for every complexity bucket (0/3/4/6/8 sides), which
`node.test.ts`'s "extrudes a prism upward from y=0" pair already pins and a direct
`Box3.setFromObject` measurement confirms. The apparent taper is perspective: at eye height,
close to a building far taller than it is wide, the near vertical edges diverge toward the top
of frame. There is no geometry defect to fix, and the edge-outline work below stands on its own
merits rather than as a workaround for one.

So "just blobs" is a rendering/legibility problem, not a missing encoding. Two further likely causes, both addressable independently:

1. **Silhouette is a top-down signal, street level removes the vantage that shows it.** A triangular vs. hexagonal footprint is easy to read from orbit/overview but hard to distinguish edge-on at eye height, especially at typical building spacing. Cityscape inherits `tiles3d`'s geometry unchanged (per the "3D is just extrusion over the 2D layout" rule), so nothing skin-specific currently compensates for the street vantage.
2. **Uniform flat material.** `facade()` (`node.ts:55-79`) gives every building the same `roughness`/`metalness` and no edge/texture treatment — hue is the only strongly-legible differentiator at range; shape has to be inferred from silhouette alone, which compounds problem 1.

**Fix, in order of leverage:**
- Add edge/wireframe accenting (a thin contrasting outline on each facade edge via `THREE.EdgesGeometry` + `LineSegments`, or a subtle bevel) so corner count reads as a crisp silhouette cue even at oblique street-level angles — cheapest, purely additive in `node.ts`'s `body()`.
- Consider per-bucket surface treatment (not per-building, to avoid spending a second channel on the same complexity fact) — e.g. sharper specular highlight on the alarm-bucket cylinder — optional, evaluate after the edge-outline fix alone is tested live.
- Do **not** change what drives shape/height (`sides`/`depth` stay as-is) — this phase is a rendering-fidelity fix, not an encoding change, per `docs/serve.md`'s "a skin may reinterpret theme, never encoding" rule.

**Tests (RED first).** Snapshot/visual-regression style is awkward for three.js geometry; prefer a unit test asserting `body()` attaches an edges/outline child object when the feature ships, plus a manual in-browser check at street level (walk close to a triangle-bucket and a hexagon-bucket building, confirm the shapes are distinguishable without needing to look straight down).

## Phase 5 — Legend disappears when its tray is collapsed (bug)

**Root cause, confirmed in source.** `Tray` (`packages/design-system/components/layout/Tray.jsx:6-19`) is a generic collapsible panel: `{open && <div>{children}</div>}` (line 17) hides *all* children when the header is clicked closed. `App.tsx:342-344` nests `Legend` as the sole child of `<Tray title="Layers" dock="left">` — so collapsing that one tray (meant to hide the layer list) also hides the legend, which the user expects to stay visible as a permanent reading aid. This is a composition bug in `App.tsx`, not a defect in `Tray` itself.

**Fix.** `Legend` is the *only* child of the "Layers" tray today (`App.tsx:342-344`) — there is no separate layer list to keep collapsible. So do not build two trays: rename the single tray to "Legend" and make it non-collapsible (`collapsible={false}`, already supported by the component's prop signature). This same tray is where Phase 6 adds the controls-help content, so it becomes one shared always-visible rail.

Structure in `App.tsx`'s left-column block (~line 340-346):

```
<div data-testid="legend-rail" style={{ flex: "none", display: "flex", flexDirection: "column", minHeight: 0 }}>
  <Tray title="Legend" dock="left" collapsible={false}>
    <Legend units={units} mode="current" />
    {/* Phase 6 adds <ControlsHelp .../> here, same tray */}
  </Tray>
</div>
```

Note the rail `div` currently has `display: "flex"` with **no** `flexDirection` (`App.tsx:341`); adding `flexDirection: "column"` is a required part of this change, so the tray and Phase 6's content stack rather than sitting side by side.

With the tray no longer collapsible, the original bug ("collapsing Layers hides the Legend") is structurally gone rather than worked around.

**Tests (RED first).** `packages/ui/test/App.test.tsx`: assert the legend content is present in the DOM and that clicking the tray header does **not** remove it — with `collapsible={false}` the header is inert, which is the property worth pinning (the old "collapse Layers" gesture no longer exists).

## Phase 6 — "How to navigate" guide, in the same always-visible legend tray

**Problem.** The left tray (`Tray title="Layers" dock="left"`, `packages/ui/src/App.tsx:341-346`) shows the `Legend` in "current" mode regardless of which skin is active — nothing tells a first-time user that tiles3d is orbit-drag/scroll-zoom, or that cityscape is WASD + pointer-lock at street level and fly-drag above it (`packages/ui/src/controls3d.ts`). This is the cheapest, most direct fix for "hard to navigate/understand" — a legend, not new mechanics.

**Fix.**
- Add a `ControlsHelp` component (`packages/ui/src/ControlsHelp.tsx`) rendering a short skin-specific key/mouse legend:
  - `tiles3d` (orbit): drag to orbit, scroll to zoom, double-click a building to drill.
  - `cityscape`, overview/"Fly": drag to look, WASD to move (once Phase 1's drag-control fix lands, describe whatever control model is actually shipped — do not document `FlyControls`' current behavior if it's being replaced).
  - `cityscape`, street/"Walk": click to lock pointer, WASD/arrows to move, mouse to look, Esc to release, double-click a building to drill, minimap bottom-left shows position and facing.
- Reuse the **same** always-visible "Legend" `Tray` introduced in Phase 5 — do not add a second tray. Render `<Legend .../>` then `<ControlsHelp skin={renderSkin} view={...} />` stacked inside that one non-collapsible tray, gated on `mode === "current" && renderSkin !== "tiles"`. One legend rail always on screen, carrying both channel meaning and control help.
**Prerequisite — lift the view state (this is a real diff, not a free lookup).** The walk/fly state is *not* readable from `App.tsx`. It lives as local `useState` inside `Canvas3dHost` (`Canvas3dHost.tsx:52`), and the store (`store.ts:9-14`) tracks `renderSkin` but no view mode. `ControlsHelp` renders in `App.tsx`'s left rail — a **sibling** of `Canvas3dHost` — so it cannot see that state.

Lift `view` into the store alongside `renderSkin` (`ControlsHelp` needs both, and the store already carries the other cross-cutting view state). Sites to change:
- `Canvas3dHost.tsx:52` — the `useState` declaration.
- `Canvas3dHost.tsx:289` — the toggle's `setView` call.
- `Canvas3dHost.tsx:185` and `:228` — effect dependency arrays that read `view`.

Do this before writing `ControlsHelp`, and size Phase 6 to include it.

**Sequencing note.** Do this *after* Phase 1 (whichever fly-mode control replaces `FlyControls` — the guide must describe the control model actually shipped) and Phase 5 (the shared tray must exist first) — otherwise the guide documents behavior that's about to change underneath it, or has nowhere to live yet.

**Tests (RED first).** `packages/ui/test/App.test.tsx` or new `ControlsHelp.test.tsx`: renders the correct legend text for each `(renderSkin, view)` combination; absent when `renderSkin === "tiles"`; present in the same DOM tray as `Legend`. Also pin the lifted state: toggling walk/fly updates the help text from outside `Canvas3dHost`.

## Phase 7 — Large-repo layer count (readability at scale)

**Problem.** `docs/implement-serve.md:121-131` already flags this: real repos cluster into 15+ top-level layers vs. orderly's 6; recommends **Option 1** — cap Pass B / Interpreter clustering to 5–9 top layers, nest the rest under a synthetic rollup group, one extra drill reveals them. Not implemented yet.

**Fix — two tracks, independent lead times:**

*Near-term UI mitigation (ships first, no Interpreter/LLM risk):*
- Search-to-focus: a search box that jumps straight to a unit by name, bypassing the top-level layer tree entirely on a deep hierarchy.
- Default-collapse layers beyond the 6th in any layer/tree UI.

*Root fix (Interpreter clustering pass, longer lead time — coordinate with whoever owns Pass B):*
- Locate the clustering pass (`packages/interpreter` — confirm exact file, e.g. `pass-b.ts` / `orchestrate.ts`) and add a `MAX_TOP_LAYERS` (5–9) cap: if cluster count exceeds it, merge the smallest/least-central clusters into named synthetic parent groups (deterministic naming/hashing so replay stability holds, per `docs/design.md`'s layout-seeding requirement).
- Drilling into a synthetic group shows its real children as a normal one-level-deeper Scene — no new Unit kind needed, consistent with "one recursive Unit type."

**Tests (RED first).** Interpreter: cluster-merge logic — output ≤ `MAX_TOP_LAYERS`, full file coverage preserved after merge, deterministic across runs. UI: search-to-focus jumps correctly; default-collapse state.

## Branching

Branch `feature/cityscape-skin` has not merged to `main` yet — it's the branch that introduced `tiles3d`/`cityscape` (Wave 5). Phases 1-6 are bug fixes and legibility polish on code this same branch introduced, so they continue on `feature/cityscape-skin` and ship together in its eventual PR. Phase 7 (Interpreter layer-cap) touches unrelated clustering code in `packages/interpreter`, has its own owner/review, and higher risk (LLM clustering behavior change) — it gets its own branch off `main` (after this one merges, or independently), not a ride-along on this feature branch.

## Sequencing

1. **Phase 1 first** (`packages/ui`). Ship and verify live before anything else; this alone may resolve most of the "hard to navigate" complaint. **Within Phase 1, fix Bug B before Bug A** — the compass symptom is plausibly caused by the fly-control spin, so Bug A may need no separate fix once B lands. Re-check the compass in the browser after B before writing any minimap change.
2. Phase 2 + Phase 3 (both UI-only, `packages/ui` + `packages/skins/cityscape`) — one branch, since Phase 3 depends on Phase 2's occlusion fix being in place to read correctly during auto-drill transitions.
3. Phase 4 (`packages/skins/tiles3d`) — independent of 2/3, can ship in parallel; touches shared geometry so both `tiles3d` and `cityscape` benefit.
4. **Phase 5** — build the shared always-visible "Legend" tray (`packages/ui/src/App.tsx`). Independent of 2/3/4, but must land before Phase 6.
5. **Phase 6 last of the UI fixes** — lifts `view` into the store, then adds `ControlsHelp` into Phase 5's tray; depends on Phase 5 (tray must exist) and should document the *final* control scheme, so it also depends on Phase 1's fly-control choice being settled first.
6. Phase 7 UI mitigation (search-to-focus, default-collapse) — can still ship on `feature/cityscape-skin`, it's UI-only.
7. Phase 7 Interpreter cap — own branch off `main`, needs Interpreter-pass owner review; higher risk (LLM clustering behavior change) and longer lead time. Not part of this feature branch's PR.

## Verification

- Phase 1 (Bug B): **done.** Verified in-browser on `fixtures/orderly`: a 300px drag turned the camera 68.75°, the reverse drag returned it to 0° exactly, and holding the pointer off-centre for 1.2s produced 0° of drift where stock spun continuously.
- Phase 1 (Bug A): **done — closed as a symptom, no code change.** All four cardinals verified in-browser after the Bug B fix; see the Phase 1 Bug A table.
- Phase 2: manually drive cityscape in-browser (per CLAUDE.md's "test the golden path in a browser" rule for UI changes) — confirm a focused building is never visually occluded by a faded one, and a high-risk beacon stays visible when unfocused/behind other geometry.
- Phase 3: walk toward a building in cityscape without clicking; confirm auto-drill fires at the threshold and auto-ascend on backing away, with no flicker at the boundary; confirm manual dblclick drill/ascend still work unchanged.
- Phase 4: **done.** The height curve is now `MIN_DEPTH + √sloc × DEPTH_PER_SQRT_SLOC` (120 / 22), which compresses a 40x sloc spread to roughly 6x. `MIN_DEPTH = 120` carries the Checkpoint 2 constraint on its own — it clears `MIN_DIM`'s 96 before any sloc is added, so *every* building is taller than its footprint is wide, not just the median one. That matters more than the median rule the phase asked for, because `fixtures/orderly`'s median unit is 2 sloc. `packages/layout/test/layout.test.ts` pins the sub-linear ratio, monotonicity, the floor, and the ≥96 slab regression. Edge outlines ship as an `EdgesGeometry` child thresholded at 20° so the 24-segment cylinder does not read as a hatched drum; `node.test.ts` pins that the outline exists, stays under the barrel-segment count, and does not steal the raycast from `body`.
- Phase 5: **done.** The rail is one non-collapsible `Tray title="Legend"`. Verified in-browser: the header reads "LEGEND" and clicking it leaves the content in place. Because `Legend` was the tray's only child, this removes the bug's precondition rather than working around it.
- Phase 6: **done.** `view` now lives in the store beside `renderSkin`; `ViewMode` moved there with it so the store stays free of three.js imports. Verified in-browser across all three skins and both cameras: `tiles` renders no help, `tiles3d` shows orbit/scroll/click/double-click, cityscape-fly shows drag/WASD/R-F/double-click, and the walk toggle rewrites it to the pointer-lock five — from outside the canvas, which is what the state lift buys.
- Phase 7 (UI mitigation): **done.** `UnitSearch` matches unit names by case-insensitive substring — module names are path-like, so the memorable part is rarely at the front — and `revealUnit` drills to the parent *before* selecting, since `drill` clears selection and a bare select would highlight something off screen. Verified in-browser: searching "connection" returns exactly `src/db/connection.py`, and picking it drills to `src.db`, puts the tile on screen, and opens the inspector on it. The legend collapses groups past the sixth behind a "Show N layers" row.
- Phase 7 (Interpreter cap): **not started — out of scope for this branch** by the Branching section above. It needs its own branch off `main`. Acceptance when it runs: against a large repo, top-level layer count drops to ≤9, orderly's snapshot is unchanged, and drilling a synthetic group reveals real children one level deeper.
- Run `npm test` and `npm run lint` per package touched before considering any phase done (TDD RED-GREEN-Refactor, per CLAUDE.md).

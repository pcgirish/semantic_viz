# Checkpoint 2 — the street-level wayfinding look

**Date:** 2026-08-20 · **Fixture:** `fixtures/orderly` (105 units, 12 nodes at system level)
**Ran against:** `tiles3d` on `Canvas3dHost`, orbit and street cameras, real WebGL in a browser.

The Wave 5 plan places this checkpoint after 5.3 and before `cityscape` is written, because
it is the only cheap test of the plan's largest risk. Two questions, expected to fail
independently.

## 1. Lateral — "where am I?" — PASSES

Layer hue masses exactly as hoped. From across the scene, blue `src`/`src_db`, green
`root`/`src_orders`, and teal `scripts`/`api_gateway` read as distinct districts you can
pick out and steer toward. This held at street level, not just from orbit.

No saturation boost is needed at this scale. The plan's contingency — "turn hue saturation up
until clusters read at distance" — is not required, and `cityscape` should not spend effort
there. Revisit only if a much larger repo shows massing washing out.

## 2. Rank — "which way is up the dependency graph?" — FAILS, as predicted

Standing among the buildings there is no visual answer. Rank became a ground direction the
moment the camera entered the scene, and nothing recovers it: not hue (which encodes layer,
an orthogonal fact), not height (see below), not the edges.

**This is information, not a setback, and it settles a design question:** the minimap is
load-bearing, not decorative. It must be built in 5.4 as specified, and it should be treated
as the primary rank instrument rather than an inset — at street level it is the *only* thing
that can answer question 2.

## 3. The finding neither question anticipated: buildings are not buildings

The most consequential observation, and it has since been fixed. As found, footprints on
`fixtures/orderly` were 96×96 while `depth` ranged 4–26 — every building roughly 4:1 wider
than tall. At eye height the city was a plain of tilted plates, not a skyline.

`depth` is populated from sloc in layout units that were never scaled for a vertical axis.
The channel is correct in the encoding (`serve.md#2` — extrusion depth = sloc) and nearly
invisible in the view. Two consequences:

- The extrusion channel currently carries almost no perceptual weight in 3D.
- "Moving through a city" does not read, because there is nothing to move *between*.

**This belongs to layout, not to a skin** (`serve.md#1` — the encoding lives in the layout
engine). The fix is a vertical scale factor applied where `depth` is derived, chosen so a
median unit stands taller than it is wide. It should land before `cityscape`, because
`cityscape`'s entire premise is a walkable street, and there is no street between slabs.

## 4. Every level the 3D host renders is a single rank row

Found while fixing the framing, and it reframes question 2 rather than merely adding to it.
`Canvas3dHost` renders the Current-mode drill levels and nothing else: the root domain tier
(5 nodes) and each drilled level (1–6 nodes). Measured across all ten drillable levels of
`fixtures/orderly`, **every one has a ground depth of exactly 96** — one row of buildings,
side by side, with no second rank behind it.

So there is no street to stand in, at any level this host currently shows. The "walk down the
rank axis" reading that the street camera was built for has no geometry to express it here.

This makes question 2's failure structural twice over: rank is invisible at eye level *and*,
at these levels, rank has no extent to be visible along. It strengthens the same conclusion —
the minimap is the rank instrument — and it adds a caution for 5.4: `cityscape` should not
assume a multi-row city exists, because on this fixture it does not.

(An earlier note in this document implied the layer tier gives a 5-row, 864-deep city. That
scene is constructible from the snapshot but is not a view the app renders; "Depends on" mode
shows external packages in 2D and is not routed through the 3D host.)

## Defects found and fixed here

Putting the view on screen found four bugs that no unit test was asking about (commits
`2bfaaee` and the one carrying this document):

1. **Footprints drawn on a circumradius** — a 3-sided (low complexity) unit covered a quarter
   of its tile and read as a spike. Area stopped meaning sloc for exactly the units where the
   shape channel was most distinctive.
2. **CSS2D label DOM leaked on every navigation** — drilling one level left 11 labels on a
   6-node scene, the previous level's names floating over the new one. `disposeGraph` freed
   GPU resources but never detached label elements.
3. **The street camera spawned inside a building** — it stood on the footprint's near edge,
   which is where the outermost building is. Measured clearance on `fixtures/orderly` was
   `0.0`.
4. **The standoff ignored the city's width** — fixing (3) and the vertical scale left the
   standoff derived from ground depth and building height only. Because every level is one
   shallow row (see §4), width is the binding dimension at every one of them, and a single
   96-wide facade overflowed a 60° frame: drilling into `src_db` gave a viewport of flat
   blue. The standoff is now the largest of three terms — ground depth, height-to-fit, and
   width-to-fit — computed against the host's FOV.

Plus one behaviour change: reframing is keyed on `focus` as well as `view`, so drilling into a
new level frames it while a replay scrub still leaves the camera alone.

## Verdict

Proceed to 5.4. Carry four things into it:

- **Do not** spend effort on hue saturation — question 1 already passes.
- **Do** build the minimap first and treat it as the rank instrument, not an inset.
- **Do** fix the vertical scale in `layout` before writing `cityscape`, or the walkable view
  has nothing to walk between. *(Done — `MIN_DEPTH` 4→40, `DEPTH_PER_SLOC` 0.6→3, so a
  40-sloc unit stands taller than its 96-wide footprint.)*
- **Do not** assume a multi-row city (§4). If `cityscape` needs one, that is a layout change
  and a scoping decision, not something the skin can invent.

## Open, deliberately not fixed here

- **Labels overlap in the middle of the frame.** At root level `scripts`,
  `migrations_group`, and `src_db` collide into unreadable overlapping text. This is the
  plan's "label legibility at distance" risk, now confirmed rather than hypothetical. It
  needs distance-based culling or collision-aware placement in 5.4, not a framing tweak.
- **WebGL context leaks under repeated skin toggling** are still only unit-tested. The
  plan's manual check — toggle 20× and watch for context warnings — has not been run.

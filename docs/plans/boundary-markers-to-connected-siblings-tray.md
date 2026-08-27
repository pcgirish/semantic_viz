# Boundary markers → connected-siblings tray

## Context

Drilling into a layer (e.g. `Backend Domain › Auth Service`) draws that layer's child
module tiles plus a column of **boundary markers** at the right of the canvas — one per
*sibling* layer that has edges crossing the focus boundary. Three defects make these read
as a bug rather than a feature:

1. **They look like modules.** Markers render as ordinary `PolyNode` tiles, only dimmed
   (`BOUNDARY_DIM = "opacity(0.55)"`), so `↔ Word Problem Core (10)` sits in the same
   visual vocabulary as `auth_service.py`. Nothing says "this is a different kind of
   thing" — dimming reads as *less important module*, not *different category*.
2. **They overlap.** `packages/skins/tiles/src/node.tsx` passes `size={n.w}` (96) but never
   passes `PolyNode`'s `height` prop, so `PolyNode` falls back to `h = size` = 96 while
   `layout.ts` stacks markers on a `MARKER_H + MARKER_GAP` = 72px pitch. Every marker is
   24px taller than its slot. The layout test named *"clamps markers to the frame edge and
   spreads them so they do not overlap"* passes, because it asserts non-overlap in **scene**
   coordinates — the defect exists only in the render path, which no test covers.
3. **They show no links.** Hovering or selecting a marker highlights nothing. The crossing
   edges are never emitted into `scene.links`: `buildScene` consumes `boundaryEdges` only to
   synthesise marker *nodes*. `CanvasHost`'s `neighbours(hover, scene.links, 1)` therefore
   finds no link touching a marker id, and connector recolouring (which keys on
   `l.from/l.to === hover`) matches nothing. **The markers assert a relationship the scene
   graph has no record of.**

Defect 3 is the one the user hit directly ("currently, when I select one of those, or hover
over, I don't see any links"), and it is the load-bearing one: the interior endpoint of each
crossing edge is computed and then discarded, so there is nothing to highlight *with*.

Verified against the real snapshot `../eq_to_word_problem/.scv` (`c5ee733`): the three
markers on Auth Service are its sibling layers, and the on-screen counts 7/10/2 match
`collectBoundaryEdges` exactly. Raw crossing counts are 9/13/3; the difference is the
visible-tile filter dropping crossings whose interior endpoint has no visible tile.

**Intended outcome:** replace the in-canvas marker tiles with a labelled tray of listed rows
docked inside the canvas's right edge. Hovering a row highlights the interior tiles it
couples to and recolours their crossing connectors; clicking pins that highlight.

## Decisions

Settled with the user before planning. Each replaced a plausible alternative, so the
rationale is recorded rather than just the choice.

| Question | Decision | Why |
|---|---|---|
| Presentation | Listed rows in a tray, not blocks | Rows carry a name, a direction and a count without pretending to be scene geometry. The overlap and the category confusion both stem from markers being tiles. |
| Highlight | Light participating tiles + recolour their crossing connectors; dim the rest | Answers "what does this sibling actually touch?" **No** stub edges drawn into the tray — a stub would reintroduce fake geometry. |
| Zero-link siblings | Shown, greyed, sorted last (`Backend Constants · no links`) | Makes "not coupled" distinguishable from "not shown". Today a sibling with no crossings is simply absent, which is indistinguishable from a bug. |
| Click | Pins the highlight; click again unpins | Hover alone cannot be inspected — the pointer must leave the row to read the canvas. Explicitly **no** navigation, breadcrumb change, or Inspector/selection change. |
| Placement | Overlay inside the canvas, right edge | **Chosen explicitly by the user over a docked side-by-side column, which was the recommended option.** Keeps LEGEND left / canvas centre / INSPECTOR far right intact, and avoids reflowing the scene (which would invalidate the seeded positions `buildScene` depends on) every time the tray opens or closes. See §7 for the overlap this costs and how it is mitigated. |

**Deferred by the user:** breadcrumb / sideways navigation on click. Worth recording *why*
it is awkward: a sibling layer is one level **up** from the tiles in frame, so opening one is
a sideways move (`Backend Domain › Word Problem Core`), not a drill-down. That mismatch is
the likely reason clicking a marker never updated the breadcrumb in the first place.

## Approach

### 1. Carry the interior endpoints through

This is the load-bearing change; everything else is presentation.

`collectBoundaryEdges` (`packages/ui/src/App.tsx`) already builds a `toVisible` map — every
unit to its nearest *visible* ancestor — via the existing `buildUnitToAncestor` helper in the
same file, and uses it **only as a filter**: it looks up the interior endpoint's visible tile,
keeps the edge if one exists, and throws the tile id away. Keep it instead.

Emit a per-sibling row array alongside the existing return values:

```ts
export type SiblingSummary = {
  /** Sibling unit id — the row's identity. Not necessarily a `layer`: see §6. */
  id: string;
  name: string;
  /** Visible interior tile ids this sibling couples to (deduped). */
  interior: string[];
  inCount: number;
  outCount: number;
  edgeCount: number;
  /** `null` for a zero-link sibling — it has no direction, and must not be
   *  defaulted to "out" by an `inCount > 0 ? "in" : "out"` ternary. */
  direction: "in" | "out" | "both" | null;
};
```

Rows cover **every** sibling, not just coupled ones; uncoupled siblings get `edgeCount: 0`,
`interior: []`, `direction: null`. Sort by `edgeCount` descending with zero-link rows last.

Keep this array **separate from `externalUnits`**. `externalUnits` feeds `buildScene`;
widening it to include uncoupled siblings would change layout behaviour and break existing
boundary tests for no benefit. The tray is a DOM overlay, not scene geometry — routing it
through `Scene` would re-import the very coupling this change removes.

### 2. Delete the marker machinery

`n.boundary` has exactly two consumers, both in `packages/skins/tiles/src/node.tsx`. The 3D
hosts never receive `boundaryEdges` at all (`Canvas3dHost` is passed neither it nor
`externalUnits`), so `tiles3d`/`cityscape` never had markers and are unaffected.

Remove `boundaryMarkers()` and its `MARKER_W/H/GAP` constants from
`packages/layout/src/layout.ts`, the `SceneNode.boundary` field from
`packages/layout/src/scene.ts`, and the boundary branch, glyph map and dim filter from
`node.tsx`. The direction glyphs move to the tray.

Deleting rather than keeping-and-filtering is deliberate: leaving dead marker nodes in
`scene.nodes` to be filtered at render is precisely the dead code in touched scope that
`CLAUDE.md` says to remove, and it would leave the overlap bug latent for any future
consumer. Deleting also makes defect 2 moot — nothing renders a marker as a tile any more.

### 3. The tray component

New `packages/ui/src/ConnectedSiblingsTray.tsx`, modelled on the existing
`packages/ui/src/EntryPointsRail.tsx` — the established "clickable rows inside a `Tray`,
canvas shows the result" pattern, whose docstring already states that split. Reuse the
design-system `Tray` (`packages/design-system/components/layout/Tray.jsx`) with
`dock="right"`, `floating`, `collapsible`, `defaultOpen`; the default `--tray-w` (320px) is
too wide for an in-canvas overlay, so pass a narrower width.

Rows read `↔ Word Problem Core · 10 links`; zero-link rows read `Backend Constants · no
links` in `--text-faint` and are non-interactive.

**Positioning:** `position: sticky`, mirroring the existing elided-edges badge in
`CanvasHost.tsx`. Sticky pins to the scroll container, which *is* "inside the canvas, right
edge"; `fixed` would pin to the window, escape the canvas and overlap the Inspector.

The tray must be a **direct child of `.canvas-scroll`**, as a sibling of the elided-edges
badge and *outside* `.canvas-extent`. This is load-bearing, not incidental: `.canvas-scale`
carries a `transform: scale()`, and a transformed ancestor establishes a new containing block
for positioned descendants — a tray nested inside it would scroll and scale with the scene
instead of pinning, which is the behaviour being removed. The existing comment above the
badge already documents the sticky-not-absolute reasoning.

Stack the two in one right-floated column so they do not collide when both are visible.

The tray needs `pointerEvents: "auto"` (the badge sets `none`), and its mouse handlers must
`stopPropagation` so hovering a row does not reach `.canvas-scroll`'s `onMouseLeave` (which
clears hover) or its pan `onMouseDown`.

### 4. Highlight wiring

`focus.js` states the contract: *"the design system owns the LOOK; the product owns the
traversal that produces the id sets."* A tray row is simply a different traversal feeding the
same `FocusState` — **no design-system change is required.**

**Verified constraint.** Both `focusRole` and `edgeRole` return `"none"` when `focus.id` is
null — that is the *nothing-is-focused* state, in which nothing dims. So a tray highlight
cannot be expressed as `{id: null, near: [...tiles]}`; it would render as no highlight at all.
Nor can `focus.id` be the sibling-layer id: that id is on no tile and no link, and `edgeRole`
admits an edge as `"far"` only when **both** endpoints are in the set — every crossing edge
has one endpoint outside, so all of them would come back `"muted"`, reproducing the exact bug
being fixed.

Resolution — anchor `id` on a real tile and let `near` carry the set:

```ts
{ id: interior[0], near: interior, far: [], sticky: pinned }
```

with all participating ids (including the anchor) in `near`. Consequences read off those two
functions: the anchor renders `"self"` (accent glow) and its peers `"near"` — a cosmetic wart
where one tile is a notch brighter than the others. If that reads wrong in the browser, fix
it in `focusRole` (test `near` membership before the `id` equality test) or via a skin-side
`role` override — **not** by nulling `focus.id`, which silently disables the whole highlight.

Interior-to-interior edges between two participating tiles come back `"far"` and stay
full-opacity hairline, which is correct.

#### 4a. Crossing edges must be synthesised — they do not exist in the scene

**An earlier draft of this plan was wrong here, and the error was load-bearing.** It said the
crossing edges "*are* the interior tiles' own edges, so no new links need to be synthesised",
and planned merely to recolour them. They are not in the scene at all:

`rollUpEdges` (`packages/ui/src/edge-budget.ts`) maps both endpoints to their nearest visible
ancestor and drops the edge when either is missing:

```ts
const from = toVisible.get(e.from);
const to   = toVisible.get(e.to);
if (!from || !to || from === to) continue;
```

A crossing edge's external endpoint sits outside the focus and has **no** visible tile, so
`to` is `undefined` and the edge is discarded before `visibleEdges` is built. `App.tsx` states
this in a comment directly above the `collectBoundaryEdges` call: *"Edges with exactly one
endpoint inside the focus were dropped by the loop above (their outside endpoint has no
visible tile). They come back as boundary markers on the frame."*

So the markers were not merely a poor rendering of the crossing edges — they were the **only**
representation of them. Deleting them without adding a replacement removes the last trace of
the relationship, leaving §4's "recolour the crossing connectors" with nothing to recolour and
reproducing defect 3 in a new form. This is the same root cause the Context section names, and
the earlier draft removed the symptom while leaving it intact.

**Resolution: draw crossing edges from the interior tile to its tray row.** When a row is
active, synthesise one connector per participating interior tile, running from that tile's
port to the tray row's vertical position at the canvas's right edge. These are real drawn
connectors, so the user sees *which* tiles connect and in *which* direction.

This does not contradict the user's "no stub edges" decision. That ruled out **permanent**
stubs cluttering the canvas at rest — the objection was to the marker column's standing
visual noise. These appear only while a row is hovered or pinned, and vanish with it.

Implementation notes:

- Build them in `CanvasHost` alongside `connectorEdges`, not in `@scv/layout`: they depend on
  transient hover state and on the tray's DOM position, neither of which belongs in a `Scene`.
- The tray is a sticky overlay in viewport coordinates while connectors are drawn in scene
  coordinates under `transform: scale()`. Convert using the `base` origin and `scale` already
  available in `CanvasHost`, or terminate the edges at the scene-space x of the canvas's right
  edge and let the tray sit visually beyond it. **Prefer the latter** — it keeps the connector
  geometry entirely in scene space and avoids coupling edge routing to tray layout. Confirm
  the endpoints land level with their rows at several zoom levels.
- Aggregate per interior tile: one connector per tile per row, carrying the summed weight,
  matching how `rollUpEdges` already merges contributors.
- Direction encoding matches the existing tile-hover path so both read identically: an edge
  leaving the interior tile is `hover-out` (orange), one entering is `hover-in` (azure). A tile
  with both gets one connector of each.

#### 4b. The opacity dim must be lifted for these connectors

Synthesised crossing connectors have one endpoint that is not a scene node, so `edgeRole`
returns `"muted"` for them. `ConnectorLayer` then sets opacity unconditionally:

```js
opacity={e.dim||role==="muted"?"var(--focus-dim-edge)":1}
```

`kind` feeds `k.stroke` — colour only, **not** opacity. Left alone, the highlight would draw
exactly the connectors the feature exists to reveal and immediately dim them.

Fix in `ConnectorLayer.jsx`, on both the `<path>` and the animated `<circle>` dots:

```js
const lit = e.kind === "hover-in" || e.kind === "hover-out";
opacity={!lit && (e.dim || role === "muted") ? "var(--focus-dim-edge)" : 1}
```

This is a shared design-system edit and must hold for the existing tile-hover path. It does,
and is arguably a latent bug fix there: an explicit hover kind means "this edge answers the
user's hover", which should never be dimmed. Verify tile-hover rendering is unchanged.

Prefer this over passing `dim: false` from `CanvasHost`, which would push focus policy into
the product layer against the "design system owns the LOOK" contract.

**State.** `CanvasHost` currently derives focus from a single local `hover` id. Add `rowHover`
(transient) and `rowPinned` (sticky), resolved by fixed priority:

1. **tile hover** — a direct hover always wins, so a pinned row never makes the canvas
   unresponsive to pointing at things;
2. **row hover**;
3. **row pinned** — survives mouse-out; cleared by clicking the same row again.

All three stay local to `CanvasHost`. Nothing goes into `useAppStore`: the user ruled out any
selection/breadcrumb/Inspector change, and store state would leak into exactly those.

**Reset both `rowHover` and `rowPinned` when the focused unit changes.** A pin refers to a
sibling of the *previous* focus; carried across a drill or ascend it would highlight tiles
that are gone, or — worse — tile ids that happen to recur in the new scene, producing a
highlight with no visible cause. Key the reset on the focus id that drives the row list, not
on the row array's identity. Cover this with a test: pin a row, drill, assert no highlight.

### 5. Memoisation

`App.tsx` carries a comment warning that unstable props re-trigger `CanvasHost`'s build effect
and replay delta pulse animations. Compute the tray rows inside the **existing** `useMemo`
that already produces `boundaryEdges`, not a new one, or tray hovers will replay those
animations.

### 6. Siblings are not always layers

Raised by external review, and confirmed: `UnitKindSchema` (`packages/schema/src/index.ts`)
admits `system, group, layer, module, class, function, api_flow, block, unclustered`. Boundary
focus is not layer-specific — `collectBoundaryEdges` walks the focused unit's *parent's*
children, whatever kind those are. Drilling a `group` yields `layer` siblings; drilling a
`layer` yields `module` siblings; drilling a `module` yields `class`/`function` siblings.
The original marker code was equally kind-agnostic; only the wording was layer-specific.

Consequences for this plan:

- **Component name** is `ConnectedSiblingsTray`, not `SiblingLayersTray`. The row type is
  `SiblingSummary`, keyed on a unit id of any kind.
- **Row copy carries no kind noun.** A row is `↔ Word Problem Core · 10 links`, never
  "sibling layer". The tray title is `Connected siblings`.
- **No kind-conditional behaviour.** Sorting, direction glyphs, the zero-link greyed row,
  hover/pin and the synthesised connectors of §4a all key on `edgeCount` and `interior`,
  never on `unit.kind`. There is deliberately no special case for `group`: a group sibling
  is one more row.
- **Test requirement:** the `boundary.test.ts` additions must include a fixture where the
  focused unit is a `group` and its siblings are `layer`s, asserting identical row shape and
  identical `interior` resolution to the layer/module case. Without it the generic claim
  above is untested.

The one place kind still matters is the deferred navigation work, which stays out of scope:
what "open this sibling" means depends on the sibling's kind and its depth relative to the
frame. Recording that here so the deferral is not mistaken for an oversight.

### 7. Responsive behaviour of the overlay

The overlay placement is the user's explicit decision (see Decisions), so this section
specifies how to live with it rather than proposing a docked column.

An overlay costs occlusion: the tray covers scene area at the canvas's right edge, and the
user cannot see what is behind it. Required behaviour:

- **Collapsible, and it collapses to a small affordance rather than vanishing.** The
  design-system `Tray`'s `collapsible` gives this. Collapsed state is local component state,
  not `useAppStore` (consistent with §4).
- **Collapsing must not clear `rowPinned`.** A user pins a row precisely so they can collapse
  the tray and read the canvas underneath; dropping the pin on collapse would defeat the one
  interaction the pin exists for. The highlight persists while collapsed.
- **Narrow canvases.** Below roughly 640px of canvas width the tray would occlude most of the
  scene, so it must default to collapsed at that width rather than open. Use a container-width
  check on `.canvas-scroll`, not a viewport media query — the canvas is one flex child among
  LEGEND and INSPECTOR, so viewport width does not predict canvas width.
- **Height overflow.** A parent with many siblings produces more rows than fit. The row list
  scrolls within the tray (`overflow-y: auto`, `max-height` bounded by the scroll container's
  height); the tray never grows past the canvas, and never introduces a second scrollbar on
  `.canvas-scroll` itself.
- **Stacking with the elided-edges badge.** Both are sticky right-floated children of
  `.canvas-scroll`. The badge renders first and the tray below it, so neither overlaps the
  other at any width.

Out of scope: a user-draggable or user-resizable tray. If occlusion proves worse in the
browser than on paper, the fallback is the docked column the user declined — a placement
change, revisited with the user, not a silent redesign.

## Files

| File | Change |
|---|---|
| `packages/layout/src/scene.ts` | Drop `SceneNode.boundary` |
| `packages/layout/src/layout.ts` | Delete `boundaryMarkers`, `MARKER_*`, and its call site |
| `packages/skins/tiles/src/node.tsx` | Remove boundary branch, glyph map, dim filter |
| `packages/ui/src/App.tsx` | Extend `collectBoundaryEdges` to emit `SiblingSummary[]`; fold into the existing `useMemo`; pass to `CanvasHost` |
| `packages/ui/src/ConnectedSiblingsTray.tsx` | **New** — rows, sorting, glyphs, hover/pin callbacks |
| `packages/ui/src/CanvasHost.tsx` | Render tray as sticky overlay (direct child of `.canvas-scroll`); add `rowHover`/`rowPinned`; extend focus derivation and connector `kind` |
| `packages/design-system/components/viz/ConnectorLayer.jsx` | Exempt `hover-in`/`hover-out` kinds from the `role === "muted"` opacity dim, on both path and dots — without this the highlight recolours the crossing edges and then dims them |

## Verification

`npm run test` · `npm run lint` · `npm run build` (per `CLAUDE.md` — always npm commands,
never bare executables). TDD red-green-refactor is mandatory for the behaviour changes.

**Tests to delete:** the whole `describe("boundary markers")` block in
`packages/layout/test/layout.test.ts`, and the boundary cases in
`packages/skins/tiles/test/node.test.tsx`.

**Tests to extend:** `packages/ui/test/boundary.test.ts` — all five existing tests assert on
`boundaryEdges`/`externalUnits` only, and because the rows are a separate array those
assertions stay valid unchanged. Add cases for: `interior` resolving to the visible ancestor
rather than the deep leaf, zero-link siblings present with `direction: null`, and sort order.

**New tests:** a `ConnectorLayer` case asserting that an edge with kind `hover-in`/`hover-out`
renders at full opacity even when its `edgeRole` is `"muted"`, plus one confirming
non-hover muted edges still dim — this guards the design-system change that makes the whole
highlight visible, and the existing tile-hover path must be shown unchanged by it.

Then `ConnectedSiblingsTray` rendering (one row per sibling, glyph per direction, `no
links` row greyed, sort order, click toggles pin) and `CanvasHost` behaviour (row hover
populates `focus.near`; pin survives mouse-out; tile hover takes priority over a pinned row;
crossing connectors recolour by direction). Include a regression test that tray interaction
leaves breadcrumb and app-store selection untouched — that is an explicit user requirement,
not an implementation detail.

**End-to-end:** `npm run dev`, load the `eq_to_word_problem` snapshot `c5ee733`, drill
`Backend Domain › Auth Service`. Expect 6 module tiles, **no** marker tiles, and a right-edge
tray listing `↔ Word Problem Core · 10 links`, `↔ Eval Criteria · 7 links`,
`← LLM Stats · 2 links`, then greyed zero-link siblings. Hovering a row must light the coupled
tiles and dim the rest; clicking must pin it; the breadcrumb must not change. Cross-check the
counts against the numbers above — they were derived from the snapshot, so a mismatch means
the interior-endpoint mapping regressed.

Confirm in the browser that the anchor-tile brightness asymmetry noted in §4 is acceptable,
and that the tray does not collide with the elided-edges badge when both are visible.

## Out of scope

Breadcrumb / sideways navigation from a tray row (deferred; see Decisions). The 3D skins,
which never rendered markers.

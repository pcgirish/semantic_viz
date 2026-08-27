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

**A flat `interior: string[]` is not enough.** An earlier draft of this section proposed one,
and external review was right to reject it. §4a draws *one connector per interior tile per
row*, each with its own direction and stroke weight. A deduped id list cannot say which
crossing edges belong to which tile, so it cannot give a per-tile direction or weight — a row
with three tiles and ten edges collapses to "these three tiles, somehow, ten times". And
`CanvasHost` cannot recover the mapping: `BoundaryEdge` carries `{edge, external, direction}`
with no interior field, and the external endpoint is deliberately not a visible unit, so
there is nothing there to re-derive from.

So the id must be *carried*, at the point it is already computed and dropped:

```ts
/** One crossing edge, with its interior endpoint resolved to a visible tile. */
export type BoundaryLink = {
  edge: Edge;
  /** Unit id of the collapsed external endpoint (the tray row's identity). */
  external: string;
  /** The *visible* tile the interior endpoint rolls up to — `toVisible.get(insideEndpoint)`,
   *  which `collectBoundaryEdges` currently computes and discards. Never null: an edge whose
   *  interior endpoint has no visible tile is filtered out before this record is built. */
  interior: string;
  direction: "in" | "out";
};
```

This is a superset of today's `BoundaryEdge` (`packages/layout/src/layout.ts`), so widen that
type with the `interior` field rather than introducing a parallel one; `buildScene` ignores
the extra field and its behaviour is unchanged.

The tray then consumes an aggregation of those links:

```ts
/** One tray row: a sibling and everything it couples to. */
export type SiblingSummary = {
  /** Sibling unit id — the row's identity. Not necessarily a `layer`: see §6. */
  id: string;
  name: string;
  /** One entry per participating interior tile, each carrying its own direction and
   *  weight — this is what §4a draws a connector from. Empty for a zero-link sibling. */
  tiles: SiblingTileLink[];
  inCount: number;
  outCount: number;
  /** Total crossing edges — `sum(tiles[].edgeCount)`, not `tiles.length`. */
  edgeCount: number;
  /** `null` for a zero-link sibling — it has no direction, and must not be
   *  defaulted to "out" by an `inCount > 0 ? "in" : "out"` ternary. */
  direction: "in" | "out" | "both" | null;
};

export type SiblingTileLink = {
  /** Visible interior tile id. */
  interior: string;
  /** Crossing edges between this tile and this sibling, aggregated. */
  edgeCount: number;
  /** Summed `edge.weight ?? 1` across those edges, for connector stroke weight. */
  weight: number;
  /** This tile's own direction to this sibling — independent of the row's. A row can be
   *  `"both"` while each of its tiles is purely `"in"` or purely `"out"`. */
  direction: "in" | "out" | "both";
};
```

**Aggregation rule.** Group the links by `(external, interior)`. Each group becomes one
`SiblingTileLink`: `edgeCount` is the group size, `weight` the sum of `edge.weight ?? 1`, and
`direction` is `"both"` when the group contains links of both directions, otherwise the shared
one. Group those by `external` to build the row: `inCount`/`outCount` count *edges* not tiles,
`edgeCount` is their sum, and the row `direction` is `"both"` when both are non-zero, `"in"`
or `"out"` when exactly one is, and `null` when both are zero. Sort `tiles` by `edgeCount`
descending so the strongest connector is drawn first and is stable across renders.

Rows cover **every** sibling, not just coupled ones; uncoupled siblings get `edgeCount: 0`,
`tiles: []`, `direction: null`. Sort rows by `edgeCount` descending with zero-link rows last.

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
const ids = row.tiles.map((t) => t.interior);   // already sorted by edgeCount desc
{ id: ids[0], near: ids, far: [], sticky: pinned }
```

with all participating ids (including the anchor) in `near`. Consequences read off those two
functions: the anchor renders `"self"` (accent glow) and its peers `"near"` — a cosmetic wart
where one tile is a notch brighter than the others — though since `tiles` is sorted by
`edgeCount` descending, the anchor is the most strongly coupled tile, so the extra emphasis at
least falls somewhere defensible rather than on an arbitrary member. If that reads wrong, fix
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
- One connector per `SiblingTileLink` (§1), so the aggregation is already done: `weight` sets
  the stroke weight, `direction` the colour. No grouping logic in `CanvasHost`. **Clamp the
  stroke weight** — map `weight` through the existing `heavy` boolean (`> 1`) rather than
  scaling linearly; real data reaches 145 on a single tile link (see the group-focus
  acceptance case), which would otherwise draw a bar across the canvas.
- Direction encoding matches the existing tile-hover path so both read identically: an edge
  leaving the interior tile is `hover-out` (orange), one entering is `hover-in` (azure). A
  `direction: "both"` tile gets one connector of each.

**Endpoint coordinate rule.** The previous draft said "prefer terminating at the right edge,
confirm in the browser", which external review correctly called implementation guesswork. The
rule is:

The connector's far endpoint is **not** anchored to the tray row's DOM position. It terminates
at a fixed point in scene space:

```
x = base.x + base.w - MARGIN     // inside the drawable area, not beyond it
y = the interior tile's own port y
```

That is, every connector for an active row runs horizontally from its tile to a common
right-edge gutter, at the tile's own height — a short flat stub, not a line aimed at a row.

**The endpoint must stay inside `base`.** An earlier draft of this rule put it at
`base.x + base.w + GUTTER`, outside the scene box; external review was right that this clips,
and the reasoning is worth keeping because it is not obvious:

- `GraphCanvas` (`packages/design-system/components/viz/GraphCanvas.jsx:6`) sets
  `overflow: "hidden"`. `CanvasHost` renders it with `position: absolute, inset: 0` inside
  `.canvas-scale`, which is exactly `base.w × base.h`. `ConnectorLayer`'s own
  `overflow: "visible"` cannot escape a clipping ancestor, so anything drawn past `base.w` —
  the endpoint, the stroke, and the arrowhead, which extends further still — is cut off.
- The trap is that **this does not reproduce before the marker deletion.** `sceneBounds`
  (`packages/ui/src/usePanZoom.ts:12-19`) takes the extent of `scene.nodes`, and today the
  marker nodes *are* nodes sitting at the right of the scene, so they inflate `base.w`. Once
  §2 deletes them, `base.w` collapses back to the interior tiles plus `PAD`, and an endpoint
  that appeared to fit starts clipping. Any check of this rule must be run **after** the
  deletion lands, not before.

`sceneBounds` already adds `PAD = 24` beyond the right-most tile, so there is a 24-unit strip
inside `base` and to the right of every tile with nothing drawn in it. Put the gutter there:
`MARGIN` is a small constant (~4 scene units) reserving room for the arrowhead, making the
endpoint `PAD - MARGIN` ≈ 20 units clear of the right-most tile and strictly inside the
clipping box. No change to `GraphCanvas`, `sceneBounds`, or the overflow contract — which is
the reason to prefer this over widening the extent: `base` also drives `fitScale`, the scroll
extent and the zoom clamp, so inflating it to accommodate a transient highlight would change
the resting zoom of every scene whether or not a row is active.

Consequences, which are the point of choosing a scene-space endpoint:

- **Zoom and scroll are free.** The endpoint is a scene coordinate under the same
  `.canvas-scale` transform as every other connector, so it scales and pans with the scene
  automatically. No viewport↔scene conversion exists to go wrong.
- **Canvas resize is free.** `base` derives from scene bounds, not from the container, so a
  resize does not move the endpoint.
- **A collapsed tray cannot detach anything**, because nothing is attached to the tray. The
  highlight — lit tiles, recoloured connectors, dimmed remainder — is exactly as valid with
  the tray collapsed, which is what §7 requires when it says a pin survives collapse.
- **Rows and connectors are not visually joined**, and deliberately so. Joining them would
  require the tray's per-row viewport y, converting it into scene space, and re-deriving it on
  every scroll, zoom, resize, collapse and row-list scroll — five inputs, each a way for lines
  to drift off their rows. The association is carried by the highlight itself (this row lit
  *these* tiles) and by the shared direction colour, which is the question the user asked:
  *which tiles does this sibling touch, and which way?*

**Degenerate case.** The right-most tile in the scene is itself only `PAD` from the gutter, so
its stub is ~20 units long — short, but present and correctly coloured. A tile can never be
*past* the gutter, since `base.w` is derived from the tiles themselves. Test the right-most
tile explicitly: assert its connector has positive length and `x2 < base.x + base.w`.

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
  hover/pin and the synthesised connectors of §4a all key on `edgeCount` and `tiles`,
  never on `unit.kind`. There is deliberately no special case for `group`: a group sibling
  is one more row.
- **Test requirement:** the `boundary.test.ts` additions must include a fixture where the
  focused unit is a `group`, so its siblings are `group`s and its visible tiles are `layer`s
  — asserting identical row shape and identical interior-tile resolution to the layer/module
  case. (Siblings are always the focused unit's *own* kind, since they share a parent; the
  visible tiles are one level below. Both shift together as you drill.) Without this the
  generic claim above is untested. The corresponding end-to-end case is in Verification.

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
| `packages/layout/src/layout.ts` (type) | Widen `BoundaryEdge` → `BoundaryLink` with the resolved `interior` tile id (§1) — the field `collectBoundaryEdges` already computes and discards |
| `packages/ui/src/App.tsx` | Carry `interior` through `collectBoundaryEdges`; aggregate into `SiblingSummary[]`/`SiblingTileLink[]`; fold into the existing `useMemo`; pass to `CanvasHost` |
| `packages/ui/src/ConnectedSiblingsTray.tsx` | **New** — rows, sorting, glyphs, hover/pin callbacks |
| `packages/ui/src/CanvasHost.tsx` | Render tray as sticky overlay (direct child of `.canvas-scroll`); add `rowHover`/`rowPinned`; extend focus derivation and connector `kind` |
| `packages/design-system/components/viz/GraphCanvas.jsx` | **Unchanged, deliberately.** Its `overflow: hidden` is why §4a keeps the connector endpoint inside `base`; widening the extent instead would also move `fitScale`, the scroll extent and the zoom clamp |
| `packages/design-system/components/viz/ConnectorLayer.jsx` | Exempt `hover-in`/`hover-out` kinds from the `role === "muted"` opacity dim, on both path and dots — without this the highlight recolours the crossing edges and then dims them |

## Verification

`npm run test` · `npm run lint` · `npm run build` (per `CLAUDE.md` — always npm commands,
never bare executables). TDD red-green-refactor is mandatory for the behaviour changes.

**Tests to delete:** the whole `describe("boundary markers")` block in
`packages/layout/test/layout.test.ts`, and the boundary cases in
`packages/skins/tiles/test/node.test.tsx`.

**Tests to extend:** `packages/ui/test/boundary.test.ts` — all five existing tests assert on
`boundaryEdges`/`externalUnits` only, and because the rows are a separate array those
assertions stay valid unchanged. Add cases for:

- `BoundaryLink.interior` resolves to the visible **ancestor**, not the deep leaf — the
  mapping the reviewer flagged as untested. Use a fixture where the crossing edge terminates
  several levels below a visible tile, and assert the tile id, not the leaf id.
- **Aggregation:** two crossing edges from the same interior tile to the same sibling produce
  **one** `SiblingTileLink` with `edgeCount: 2` and summed `weight`, while the row's
  `edgeCount` stays 2 (edges, not tiles). This is the specific confusion the flat-array
  contract allowed, so it needs its own test.
- **Per-tile direction independent of the row's:** a sibling with one inbound-only tile and
  one outbound-only tile yields row `direction: "both"` while each `SiblingTileLink` is
  `"in"` and `"out"` respectively — never `"both"` on either tile.
- A single tile with edges both ways gets `direction: "both"` on that tile.
- Zero-link siblings present with `tiles: []` and `direction: null`.
- Sort order: rows by `edgeCount` descending with zero-link last; `tiles` by `edgeCount`
  descending (the anchor tile in §4 depends on this being stable).

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

**End-to-end, group focus** (required by external review — the case above only exercises layer
focus, so on its own it does not test the §6 generic claim). Same snapshot, drill
`Backend Domain` from root. Its siblings are the system's other children, all `group`s.
Expected, computed from the snapshot rather than guessed:

| Row | Edges | Direction | Interior tiles |
|---|---|---|---|
| Unclustered | 212 | `←` in | Word Problem Core 145, Eval Criteria 63, Auth Service 4 |
| Backend Packaging | 10 | `←` in | Word Problem Core 5, Auth Service 3, Eval Criteria 2 |
| Database Migrations | 9 | `←` in | Word Problem Core 4, Auth Service 3, Eval Criteria 2 |
| Frontend | 0 | greyed, `no links` | — |

This case is worth more than a naming check; deriving it exposed two things the layer-focus
case did not:

1. **Every row is purely inbound**, so all four direction glyphs are `←` and every synthesised
   connector is azure. The `↔`/`→` glyphs and the orange `hover-out` stroke are unexercised at
   group focus in this snapshot. Keep the layer-focus case as the direction-coverage case —
   the two are not redundant.
2. **`Unclustered` carries 212 crossing edges**, twenty times the next row. Two consequences
   to handle rather than discover at runtime: the row's count needs a sane presentation at
   three digits (the tray width in §3 was chosen against `· 10 links`), and its 145-edge
   connector must not render as an absurdly thick stroke — **clamp the synthesised connector's
   stroke weight**, mapping `SiblingTileLink.weight` through the existing heavy/normal
   distinction (`weight > 1` ⇒ heavy) rather than scaling linearly. Add a unit test for the
   clamp with a deliberately large weight.

**Clipping (unit).** Assert every synthesised connector endpoint satisfies
`base.x <= x2 < base.x + base.w` and likewise for y — the invariant §4a's endpoint rule
exists to hold. Include the right-most tile in the fixture, since it is the tightest case,
and assert its connector still has positive length. This test must run against a scene with
the marker nodes already deleted; a fixture that still contains them inflates `base.w` and
would pass vacuously.

**Clipping (browser).** With a row active, confirm the full connector — stroke *and*
arrowhead — is visible at fit scale, zoomed in, zoomed out, and panned to the right edge.
Check specifically the connector belonging to the right-most tile. Run this only after §2's
deletion has landed, for the `base.w` reason in §4a.

**Association (browser).** External review asked, fairly, whether the shared highlight and
direction colour are enough to identify the relationship given rows and connectors are
deliberately not joined. Acceptance: with a row hovered, a viewer should be able to name which
tiles that sibling touches and in which direction, without the tray. Check it on the
group-focus case above, which is the hard one — `Unclustered` lights three tiles all inbound,
so colour alone does not disambiguate it from `Backend Packaging`, which lights the same three
tiles the same colour. If the two rows prove indistinguishable in practice, the recorded
fallback is a row-to-connector cue (matching the row's hover treatment to the lit tiles'
accent), **not** re-anchoring connectors to row positions — that is the coordinate coupling
§4a exists to avoid.

Also confirm the anchor-tile brightness asymmetry noted in §4 is acceptable, and that the tray
does not collide with the elided-edges badge when both are visible.

## Out of scope

Breadcrumb / sideways navigation from a tray row (deferred; see Decisions). The 3D skins,
which never rendered markers.

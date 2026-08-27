# Boundary markers → sibling-layers tray

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
| Placement | Overlay inside the canvas, right edge | Keeps LEGEND left / canvas centre / INSPECTOR far right intact. |

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
  /** Sibling layer unit id — the row's identity. */
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

New `packages/ui/src/SiblingLayersTray.tsx`, modelled on the existing
`packages/ui/src/EntryPointsRail.tsx` — the established "clickable rows inside a `Tray`,
canvas shows the result" pattern, whose docstring already states that split. Reuse the
design-system `Tray` (`packages/design-system/components/layout/Tray.jsx`) with
`dock="right"`, `floating`, `collapsible`, `defaultOpen`; the default `--tray-w` (320px) is
too wide for an in-canvas overlay, so pass a narrower width.

Rows read `↔ Word Problem Core · 10 links`; zero-link rows read `Backend Constants · no
links` in `--text-faint` and are non-interactive.

**Positioning:** `position: sticky` inside `.canvas-scroll`, mirroring the existing
elided-edges badge in `CanvasHost.tsx`. Sticky pins to the scroll container, which *is*
"inside the canvas, right edge"; `fixed` would pin to the window, escape the canvas and
overlap the Inspector. The badge already proves sticky works in this container — stack the
two in one right-floated column so they do not collide.

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
full-opacity hairline, which is correct. Crossing edges land `"muted"` and are rescued by an
explicit connector `kind` override, which `ConnectorLayer` applies ahead of `role`; confirm
that override also wins over the `opacity` dim, and clear the `dim` flag explicitly if not.

**Direction rule**, matching the existing tile-hover encoding so both highlight paths read
identically: an edge whose `from` is in the participating set is outgoing → `hover-out`
(orange); whose `to` is in the set is incoming → `hover-in` (azure). Because the crossing
edges *are* the interior tiles' own edges, no new links need to be synthesised.

**State.** `CanvasHost` currently derives focus from a single local `hover` id. Add `rowHover`
(transient) and `rowPinned` (sticky), resolved by fixed priority:

1. **tile hover** — a direct hover always wins, so a pinned row never makes the canvas
   unresponsive to pointing at things;
2. **row hover**;
3. **row pinned** — survives mouse-out; cleared by clicking the same row again.

All three stay local to `CanvasHost`. Nothing goes into `useAppStore`: the user ruled out any
selection/breadcrumb/Inspector change, and store state would leak into exactly those.

### 5. Memoisation

`App.tsx` carries a comment warning that unstable props re-trigger `CanvasHost`'s build effect
and replay delta pulse animations. Compute the tray rows inside the **existing** `useMemo`
that already produces `boundaryEdges`, not a new one, or tray hovers will replay those
animations.

## Files

| File | Change |
|---|---|
| `packages/layout/src/scene.ts` | Drop `SceneNode.boundary` |
| `packages/layout/src/layout.ts` | Delete `boundaryMarkers`, `MARKER_*`, and its call site |
| `packages/skins/tiles/src/node.tsx` | Remove boundary branch, glyph map, dim filter |
| `packages/ui/src/App.tsx` | Extend `collectBoundaryEdges` to emit `SiblingSummary[]`; fold into the existing `useMemo`; pass to `CanvasHost` |
| `packages/ui/src/SiblingLayersTray.tsx` | **New** — rows, sorting, glyphs, hover/pin callbacks |
| `packages/ui/src/CanvasHost.tsx` | Render tray as sticky overlay; add `rowHover`/`rowPinned`; extend focus derivation and connector `kind` |

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

**New tests:** `SiblingLayersTray` rendering (one row per sibling, glyph per direction, `no
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

# serve — what the visualizer shows

> Contract in [`design.md`](design.md#schema-contract--scv1). Stack and milestones in [`implement-serve.md`](implement-serve.md).

One rule underneath everything: **position, size, and shape all carry meaning.** If a viewer cannot state what an axis means, the layout has failed. Prettiness that costs legibility is a bug.

---

## 1. The scene abstraction

Layout produces one structure; every skin consumes it and none computes its own.

```ts
type Scene = {
  nodes: { id, x, y, w, h, depth, sides, heat, ring }[]
  links: { id, from, to, path: Pt[], lane, bundle, kind, state }[]
}
type Skin = { node(n): Element, link(l): Element, theme: Theme }
```

A 3D skin maps the same `x,y` to a plane and extrudes by `depth`. If a skin ever needs to move a node, the encoding belongs in the layout engine instead.

---

## 2. Encoding

The channels, and what each one means. Nothing is decorative.

| Channel | Encodes | Notes |
|---|---|---|
| **Vertical position** | Dependency rank — callers above callees | The primary axis. Layered (Sugiyama-style) ordering |
| **Horizontal position** | Barycentre of connections, then file order | Stable across revisions; ties broken deterministically |
| **Area** | `sloc` | √-scaled so a 500-line module does not erase a 20-line one |
| **Sides** | Complexity, in 4 buckets | See below |
| **Hue** | Layer | Categorical, 6–8 max |
| **Fill saturation** | `amount` (delta mode only) | |
| **Offset ring** | `risk ≥ 0.5` (delta mode only) | A second outline offset 3px, not a colour change |
| **Extrusion depth** | `sloc` (3D skins only) | Reuses the area channel deliberately; adds no new meaning |

### Sides = complexity, with a correction

The brief asked for polyhedra whose side count tracks complexity. It was missing from the mock and from the first draft of the design. It is in now, with one change.

**Side count is not discriminable past about six.** A heptagon and an octagon are the same shape at tile size, so a linear mapping spends a channel and buys nothing. Bucket it:

| Sides | Cyclomatic complexity | Reads as |
|---|---|---|
| ▲ 3 | 1–2 | trivial |
| ◆ 4 | 3–5 | ordinary |
| ⬢ 6 | 6–12 | involved |
| ● circle | 13+ | **look at this** |

Four steps are instantly distinguishable at a glance and across a whole canvas. The **exact number is printed on the tile**, so the shape gives the gestalt scan and the numeral gives the value. The circle is deliberately the odd one out: a shape with no corners in a field of polygons is a visual alarm, and "this function has 13+ decision points" should be an alarm.

In 3D the buckets extrude to prism / cuboid / hexagonal prism / cylinder — same reading, same four steps.

### Nested children

The mock drew child previews as a row of small floor tiles. It read as texture, not information — dropped.

Replaced by a **true nested mini-map**: children are laid out with the real layout engine at reduced scale inside the parent's box, so the interior of a collapsed module is a faithful thumbnail of what you get when you open it. Expanding is then continuous rather than a jump cut. Below a legibility floor (child box < 8px), the mini-map is replaced by a single count.

---

## 3. Layout engine

- **Hierarchy.** Nested rectangles; children laid out inside the parent's box. Collapse and expand mutate the visible node set, never the graph.
- **Placement.** Longest-path ranking along the dependency axis, then barycentre sweeps to reduce crossings, then a deterministic tiebreak so the same input always yields the same layout.
- **Stability.** Positions are seeded from the previous snapshot's `layouts/` entry. This is a hard requirement: replay is unreadable if nodes teleport.

### Edge routing — the mock's real defect

Connector overlap made the mock hard to read. That is a routing failure, not a cosmetic one, and it is fixed in three parts:

1. **Lane assignment.** Each inter-rank gap is a channel subdivided into lanes. Edges are assigned lanes by a left-to-right sweep over target x, so parallel runs never share a y. Orthogonal segments with rounded corners.
2. **Bundling.** Edges sharing a source-box/target-box pair merge into one drawn path carrying a weight label. Ten call sites between two modules is one line marked ×10, not ten lines.
3. **Density gating.** Above a threshold of edges per visible node, background edges drop to a faint hairline and **only edges touching the hovered or selected unit draw at full strength**. The graph stays complete; the ink does not.

Exit criterion, from [`implement-serve.md`](implement-serve.md): under 5% crossing edges on a 200-node graph, relayout under 100 ms.

---

## 4. Views

### Current

Outermost is the system unit: layers, plus `api_flow` units as first-class objects — a route's whole path is one thing you can select, not something you reassemble by eye.

Drill with double-click, ascend with the breadcrumb or a double-click on empty canvas.

### Flows

A view of its own, not a list in the system view's rail. A real service has dozens of entry points — routes, CLI commands, queue consumers, cron jobs — and they do not fit in a sidebar next to the layers.

- **Left:** entry points, grouped by kind (`http`, `cli`, `event`, `schedule`).
- **Centre:** only the units that request actually traverses, in call order, at whatever granularity the trace reached. Each step shows its layer, file:line, sloc, complexity, and its one-line `what`. Edge kind is labelled between steps.
- **Right:** the standard tray, following the selected step.

This is the view where a reader asks "what happens when someone POSTs an order" and gets an answer without assembling it from a graph by eye. It is also where cross-language flows live: a TypeScript client and a Python handler matched by route string appear as consecutive steps, marked `source:"llm"`.

In Delta mode, changed steps carry a status dot, so "did this PR touch the checkout path" is one glance rather than a search.

Branching flows (conditionals, fan-out to a queue) render as a split with both arms shown; v1 traces the linear path and marks the branch point.

### Depends on

A separate view, not a filter. Externals arranged in rows by `depth` — direct at the top, transitive below — sized by `transitive_count`. Reading downward is reading how far your supply chain reaches.

Selecting an external lists every unit that reaches it and why it is present.

### Delta

Global **Current ⇄ Delta** toggle. `to` is whatever the timeline has selected; `from` is chosen by an **Against** picker with two presets, because the two questions are different and both are asked:

| Preset | `from` | Answers |
|---|---|---|
| **Previous** (default) | the selected rev's parent | "what did this commit do" |
| **Branch base** | the merge base | "what does this PR do" |

Default is **Previous**, so scrubbing the timeline shows each commit's own contribution rather than a monotonically growing pile. Opening the tool on a PR should flip the default to Branch base — that is the review question, and it is the one the inspect queue is tuned for.

The distinction matters more than it looks. On `orderly`, Previous at HEAD reports 15 unit deltas; Branch base reports 38. Neither is wrong; they answer different questions, and a tool that silently picks one is lying by omission.

- Fill encodes `amount`, offset ring encodes `risk`.
- Added and removed get **dedicated glyphs**, never colour alone.
- Collapsed parents inherit the rollup, so a hot leaf is visible as a hot ancestor before you drill.
- Edge deltas: added solid accent, removed ghost dashed.

**The inspect queue is the primary interface in this mode.** The ranked list of what deserves a human, each entry carrying status, risk, confidence, and the first sentence of the `why`. Selecting an entry flies the canvas to that unit. The map is how you verify the ranking; the ranking is why the tool was opened.

Low-confidence entries render differently — a distinct border treatment plus an explicit callout in the tray. `utils/logging` at confidence 0.55 must not look like `tests` at 0.93.

### Replay

Scrub the rev timeline. Each step animates positions using seeded layout and pulses changed units. PR-level by default; commit-level as a density toggle. Bars in the timeline are per-rev `amount`; human and agent commits are distinguished, because "which of these did a person write" is a question reviewers actually ask.

---

## 5. Inspector tray

Right tray, always present, follows selection. Renders every Unit field:

`name` · `id` · `kind` · file — tags — signature (in / out / raises) — **what / how / when / where / why** — metrics (sloc, fan in/out, complexity, I/O, cost estimate, churn) — **depends on** (outgoing) — **used by** (incoming).

In delta mode it adds status, amount, commit, author, blast radius, fields changed, before/after diff, the five risk axes as bars, the `why`, and confidence with its ground-truth reference.

Empty states carry information rather than apologising. No dependents reads: *"Nothing. Removing this is free — or it is orphaned."*

Hovering any unit highlights `depends_on` and `users` in **different colours with different arrowheads**, and dims everything else. Direction is a distinct visual question from connection, and conflating them is the most common failure in dependency UIs.

---

## 6. Skins

`Skin = { node, link, theme }`. Zero layout-engine changes to add one.

- **`tiles`** (v1) — flat polygons, maximum legibility. The reference implementation.
- **`tiles3d`** — same scene, extruded prisms, orbit camera.
- **`atlas` / `cityscape` / `landscape` / `seafloor`** — later.

> **Implementation status (2026-08-20):** both `tiles` and `tiles3d` implement this
> contract, but `packages/ui` does not yet *consume* it — `CanvasHost` renders tiles
> with `packages/design-system` components and imports only the layer palette from
> `@scv/skin-tiles`. Making the skin selectable therefore requires routing rendering
> through the contract first; scoped as Wave 5 in
> `docs/plans/remediation-security-clustering-canvas-docs.md`.

A skin may reinterpret the *theme* freely. A skin may not reinterpret the *encoding*: rank is still vertical, area is still sloc, sides are still complexity. Otherwise two people looking at the same repo in two skins are not looking at the same thing.

### Navigation belongs in the skin contract

"3D is just a skin" holds for **geometry** and breaks for **navigation**. A cityscape you walk through at street level needs things a 2D map never needs: a camera model, occlusion handling, level-of-detail on approach, and wayfinding. A 2D map cannot hide a node behind another node, and you cannot get lost in it. Both become real problems the moment the viewer is inside the scene.

So the contract extends:

```ts
type Skin = {
  node, link, theme,
  camera: 'fixed' | 'orbit' | 'walk' | 'fly',
  navigate(intent: Intent): CameraMove
}
type Intent = {kind:'focus'|'drill'|'ascend'|'trace', unit?: UnitId, path?: UnitId[]}
```

The application never sets a camera position. It emits an intent — *focus this unit*, *drill into it*, *trace this flow* — and the skin decides what that means. In `tiles` it is a pan and a zoom; in a walkable `cityscape` it is a path along the streets to the building's door.

**Streets come free.** The routing channels between ranks already form a grid of corridors that no node occupies. A cityscape skin's streets are its layout's channels. This is a real argument for keeping 3D as extrusion over the 2D layout rather than a separate 3D placement: a genuine 3D layout would have to invent a street network, and would no longer be a skin.

Occlusion is the cost that has to be paid explicitly: non-focused buildings render translucent, a top-down 2D inset stays on screen for wayfinding, and high-risk units project a beacon above the roofline so the thing you most need to see cannot be hidden behind the thing you do not.

### Why the fourth bucket extrudes to a cylinder, not a sphere

A sphere is the more alarming shape, and alarm is what the 13+ bucket is for. It is still the wrong choice.

The first three buckets are prisms — extruded polygons — and a cylinder is what an n-gon prism becomes as n grows, so it keeps the family and keeps **height meaning sloc**. A sphere has no flat top: its height is its diameter is its width, so it collapses the size and depth channels into one and silently stops reporting sloc.

Alarm should come from a channel that is not already carrying data — the risk ring, or the beacon above. Shape is spent.

The exception is representational skins. A skin may reinterpret theme, and in `cityscape` the 13+ bucket can be a dome rather than a silo, because a dome is a landmark and landmarks help wayfinding. That is legitimate precisely because a dome still has a height.

---

## 7. Known gap

The current mock is functionally close but visually flat — noted and deferred. The specific work: sides-as-complexity, the nested mini-map, lane-assigned routing with bundling, and a real material treatment for the tiles rather than flat fills. Deferred does not mean optional; V3 does not exit without them.

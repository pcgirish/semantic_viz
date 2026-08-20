# Wave 5 — a real skin contract, and a 3D view you can move through

> **Status.** 5.1 done (`packages/skin-contract` shipped, both skins import it, `depth`
> populated). 5.2 in progress. Supersedes the earlier "make the skin contract real (PR J)"
> plan at this path, whose recommendation to archive `tiles3d` is overtaken by Decision 3.

## Context

**What prompted this.** The `Skin` contract in `docs/serve.md#6` was designed so a 2D skin
could be swapped for a 3D one. It has never been exercised: `packages/ui` renders tiles with
`@scv/design-system` components directly and imports only the *palette* from `@scv/skin-tiles`.
The contract is unused, and `tiles3d` — a working extrusion skin — is unreachable from the app.

**The goal, in the user's words:** *"a good 3D view that makes users feel like they are moving
in a 3D space of the codebase"*, built on *"a skin contract that allows us to replace a 2D skin
with 3D."* Both halves are required. A contract nothing swaps through is unproven; a bespoke
3D view that bypasses the contract teaches the codebase nothing.

**Layering** (settled with the user; `design-system` stays skin-agnostic):

| Layer | Owns | Knows about |
|---|---|---|
| `layout` | Scene: positions, sizes, encoding | nothing below it |
| `design-system` | colours, shapes, connectors, texture, 3D light rig | nothing — agnostic |
| `skins/*` | Scene → drawable; declares camera model + `navigate()` | layout + DS tokens |
| `ui` hosts | canvas, render loop, input, camera execution | the contract, never a skin |

**Geometry is just a skin; the host is not.** `serve.md#6`: *"'3D is just a skin' holds for
geometry and breaks for navigation."* A skin returns objects and returns; something must own
the WebGL canvas, the `requestAnimationFrame` loop, camera controls, and raycasting. So the
accurate statement is **3D vs 2D = a skin plus the host that can draw it**: the contract makes
the skin swappable, but a `<div>` cannot render WebGL. One new host, two new skins.

The contract already anticipates this — `camera` and `navigate(intent)` exist so the skin
*declares* its navigation model and the host *executes* it. The app never sets a camera
position; it emits "focus this unit" and the skin decides whether that is a pan-zoom or a walk
down a street. That is the seam that keeps navigation out of the application.

**Outcome:** three skins (`tiles` 2D, `tiles3d` orbit, `cityscape` walk/fly) behind one
contract, switchable in the toolbar, with the 2D view pixel-unchanged.

---

## Verified facts this plan rests on

Checked against source, not inherited from the prior plan (which was wrong on three points —
see "Corrections" at the end).

- `SceneNode` (`layout/src/scene.ts:3-25`) **already carries** `name`, `layer`, `sloc`,
  `complexity`, `fanIn`, `fanOut`, `ring`, `sides`, `blockType`. Comment at :12 — *"a skin
  renders text from the Scene alone, never a raw Unit."* Labels and layer colour in 3D need
  **no contract change**; `tiles3d` simply doesn't read these fields yet.
- `depth` is hardcoded `0` (`layout/src/layout.ts:142`) — declared as the extrusion channel,
  never populated. `tiles3d` derives height from `sloc` instead. Dead field; decide and fix.
- **Scale is small.** `fixtures/orderly` = 105 units / 94 edges; largest layout test = 400
  nodes (`layout/test/crossings.test.ts:144`). Naive per-node meshes are fine. No instancing,
  no LOD.
- **Zero new dependencies.** `three@0.185.1` + `@types/three` already hoisted via `tiles3d`.
  `node_modules/three/examples/jsm/` ships `PointerLockControls`, `FlyControls`,
  `FirstPersonControls`, `OrbitControls`, and `CSS2DRenderer`.
- **The design system anticipated 3D.** `design-system/tokens/geometry-3d.css` opens with
  *"the flat UI and the 3D scene share one light rig and palette"* and defines `--light-key`
  (145deg), `--face-top/side/bottom`, `--geo-specular`, `--geo-ao`, `--geo-edge`,
  `--geo-edge-hot`, `--face-cool/warm/risk/neutral`, `--depth-1..4`, `--grid-cell`.
  `cityscape` reads these instead of inventing colours. (`--persp`/`--tilt-x`/`--tilt-z`
  describe a *fixed* isometric camera and do **not** transfer to a walkable one.)
- `hashLayerToColor` (`tiles/src/theme.ts:55`) returns hex strings — `THREE.Color` accepts
  them directly. Layer hue is shared across skins for free.
- **The 29 `CanvasHost` tests key on structural class names** — `.tile`, `.region`,
  `.canvas-scale`, `.canvas-scroll`, `.canvas-extent`, `svg path` — not on `PolyNode`
  internals. They survive a rerouting that keeps emitting those classes.
- `store.ts` has **no** `localStorage` and **no** `persist` middleware. Slices: `selection`,
  `focus`, `mode`, `rev`, `focusStack`.
- `App.tsx:302` already binds a `SegmentedControl` to a local variable named `skin` =
  `"dark"|"light"` — that is the **theme**, not the render skin. Naming collision to resolve.
- **Two divergent 2D renderers exist.** `tiles/src/node.ts` draws raw SVG (chamfer polygon,
  fitted label, meta line, complexity glyph, offset ring). `CanvasHost.tsx` draws `<PolyNode>`
  (complexity as *shape*, layer colour, and all of delta mode). Only the second is on screen.

---

## Decisions

1. **Contract lives in a new `packages/skin-contract`.** Not `packages/layout` — layout must
   not know renderers exist, or the dependency the whole design rests on inverts
   (`serve.md#1`).
2. **The 2D skin returns React elements wrapping design-system components.** The shipped look
   is canonical; `tiles/src/node.ts`'s SVG is retired (keep `measureLabel`/`fitLabel` — Wave 3
   tuned those advance widths). `serve.md` says a skin returns an `Element`; a React element
   is one. The doc predates the design system.
   → **Consequence:** `@scv/skin-tiles` gains React + `@scv/design-system` deps and stops
   being framework-neutral. Accepted: something must own "a SceneNode looks like *this*", and
   the skin is the honest place. Today `CanvasHost.shapeFor()` (`:34-40`) does it inline.
3. **Both 3D skins.** `tiles3d` stays orbit (look *at* the city); `cityscape` is new and
   walk/fly (move *through* it). `serve.md#6` already treats them as separate. Three skins
   prove the contract better than two.
4. **Walk *and* fly, switchable** — fly to travel and keep the rank overview, drop to walk on
   arrival. `serve.md#6` declares both.
5. **Skin selection is in-memory** in the zustand store. There is no pref-persistence
   mechanism to match; inventing one is out of scope.
6. **`depth` gets populated, not deleted.** `serve.md#2` names extrusion depth as a real
   channel (`sloc`, reusing the area channel deliberately). Set it in `layout.ts:142` and have
   both 3D skins read `n.depth` instead of recomputing from `sloc` — that keeps the encoding
   in the layout engine, where `serve.md#1` says it belongs. Lands in 5.1 (one line, no
   behaviour change until a skin reads it).

---

## 5.1 — `packages/skin-contract`

New package. Types only, no runtime, no `three` import.

```ts
// packages/skin-contract/src/contract.ts
import type { SceneNode, SceneLink, SceneRegion } from "@scv/layout";

/** What the app knows and the Scene cannot express. Delta info is the reason this exists. */
export type RenderContext = {
  delta?: { status: string; amount: number; risk: number | null };
  layerColor?: string;
  focusId?: string;
  gated?: boolean;
};

export type Intent =            // moved verbatim; already identical in both skins
  | { kind: "focus"; unit: string }
  | { kind: "drill"; unit: string }
  | { kind: "ascend" }
  | { kind: "trace"; path: string[] };

export type CameraMove =
  | { kind: "pan-zoom"; target?: string; path?: string[] }   // tiles
  | { kind: "orbit-to"; target?: string }                    // tiles3d
  | { kind: "fly-path"; path: string[] }                     // tiles3d, cityscape
  | { kind: "walk-to"; target?: string; path?: string[] };    // cityscape

export type Skin<TNode, TLink = TNode> = {
  node: (n: SceneNode, ctx: RenderContext) => TNode;
  link: (l: SceneLink, options?: LinkOptions) => TLink;
  region?: (r: SceneRegion) => TNode;
  theme: Theme;
  camera: "fixed" | "orbit" | "walk" | "fly";
  navigate: (intent: Intent) => CameraMove;
};
```

`node()` gains a `ctx` parameter — **this is the one real contract change**, and delta mode is
why: `TileDeltaInfo` (`CanvasHost.tsx:11`) lives outside `Scene` and `SceneNode` alone cannot
express it.

`tiles` becomes `Skin<ReactElement>`, `tiles3d`/`cityscape` become `Skin<Object3D>`. Both
skins re-export the shared types so existing importers keep working. Hosts switch exhaustively
over the `CameraMove` union.

**Do NOT** declare `SkinElement = SVGElement | Object3D | unknown` — a union with `unknown`
collapses to `unknown` and enforces nothing, and it would drag `three` into the 2D package.
The generic parameter is the mechanism.

Also in this step: populate `depth` in `layout.ts:142` (Decision 6). Inert until 5.3 reads it.

**Files:** new `packages/skin-contract/{package.json,src/contract.ts,src/index.ts}`; edit
`skins/tiles/src/skin.ts`, `skins/tiles3d/src/skin.ts` to import instead of declare;
`layout/src/layout.ts`.
**Tests:** existing `skin.test.ts` in both packages must pass **unchanged**; one new
`layout` test asserting `depth` tracks `sloc`.
**Risk: low** — types plus one field.

## 5.2 — Route `CanvasHost` through the contract

**The bar (set by the user): functionality and overall visual experience must survive.
Pixel-identity is not required.** Tiles may shift a pixel or a shade; what may not change is
what the view *tells you*. Concretely, all of this must still hold after the reroute:

- Every encoding channel in `serve.md#2` still reads: layer hue, complexity-as-shape,
  area, the risk treatment, and **all four delta states** (added / removed / modified /
  rollup) with fill saturation tracking `amount`.
- Every interaction still works: click selects, double-click drills, double-click on empty
  canvas ascends, hover highlights in/out edges distinctly and dims the rest.
- The Wave 3 fix holds: hovering a delta tile must not replay its pulse animation
  (`CanvasHost.tsx:23-31` — depends on React preserving DOM node identity across a
  hover-only prop change, so keep the stable `key`).
- Pan/zoom, scroll extent, and region boxes with their labels behave as they do now.

This is a *lower* bar than pixel-identity and a *clearer* one: it is mostly assertable in
tests rather than by eye, which makes 5.2 meaningfully less risky than the previous framing
suggested. Small visual drift is acceptable; a lost channel or a dead interaction is not.

- `tiles/src/node.ts` → returns a `<PolyNode>` React element. Absorbs `shapeFor()`
  (`CanvasHost.tsx:34-40`), `deltaTileStyle()` (`:47-57`), the layer-colour lookup (`:250`),
  and the high-risk shadow (`:265`). Keep `measureLabel`/`fitLabel`; retire the SVG polygon,
  glyph, and meta-line drawing.
- `tiles/src/region.ts` → returns the region `<div>` currently inlined at
  `CanvasHost.tsx:196-232`.
- `CanvasHost` keeps the scroll/zoom shell, `usePanZoom`, `ConnectorLayer`, and hover state;
  its node loop becomes `tilesSkin.node(n, ctx)`.
- **Must keep emitting `className="tile"` / `"region"` and the same absolute coordinates** —
  that is what preserves the 29 tests.
- `@scv/skin-tiles` gains `react` + `@scv/design-system` deps.

**Verification.** The 29 `CanvasHost` tests are the behavioural net and should still pass.
That net is smaller than the earlier scoping assumed (it said 68), which makes the new
encoding-channel tests below more important, not less.
A test that needs editing is no longer automatically a failure — but it *is* a decision
point: read it and confirm the change is cosmetic (a class list, a style shape) and not a
lost channel or interaction. Note every such edit in the PR description.

Because the tests assert structure and text rather than appearance, add coverage for the
channels that only exist in styling, which today nothing guards:
`shapeFor()` mapping per complexity bucket and `blockType`; layer colour present and stable
per layer; each of the four delta states producing its distinct treatment; the high-risk
shadow at `risk >= 0.5`. These are cheap, they pin the encoding rather than the pixels, and
they are what make "the visual experience survived" checkable instead of remembered.

Screenshots of Current and Delta before/after remain worth taking — as a judgement aid for
the reviewer, not a pass/fail gate.

**Risk: medium** (down from high — the bar is behaviour, not pixels). If a channel or an
interaction can't be preserved, stop at the checkpoint rather than shipping the loss.

## 5.3 — `Canvas3dHost` + wire `tiles3d`

First WebGL on screen. Prove the host with the simpler orbit skin before building `cityscape`.

- `packages/ui/src/Canvas3dHost.tsx`: renderer, scene, `PerspectiveCamera`, lights positioned
  to match `--light-key: 145deg`, `requestAnimationFrame` loop, `ResizeObserver`.
- **Disposal is the leak risk**: dispose geometries *and* materials per node and per link on
  unmount and on every scene rebuild, plus `renderer.dispose()`. Guard against repeated
  skin-toggling leaking contexts (browsers cap at ~16).
- Raycasting for click→`select` / dblclick→`drill`; `userData.sceneNodeId` on each group.
- `CSS2DRenderer` labels — real DOM, so they inherit design-system fonts and stay crisp.
- `tiles3d/src/node.ts`: read `ctx.layerColor` into `MeshStandardMaterial` (today it's a bare
  `new MeshStandardMaterial()` with no colour), add labels, honour `ctx.delta`, and take
  height from `n.depth` rather than its local `heightFor(sloc)`.
- Add `three` to `packages/ui/package.json` (already hoisted; no install).

**Risk: medium.** Disposal and raycasting are the parts that bite.

**Answer the wayfinding question here, not in 5.4.** Once `tiles3d` is on screen with an
orbit camera, drop the camera to street level for an afternoon — no controls polish, no
minimap, just look. Two questions, and they fail independently:

1. **Lateral — "where am I?"** Can you see a same-hue cluster from across the scene and steer
   toward it? This is the one most likely to already work, and layer hue is the whole
   mechanism. Test it by turning hue saturation up until clusters read at distance.
2. **Rank — "which way is up the dependency graph?"** Standing between two buildings, is
   there any visual answer? This is the one expected to fail, because rank became a ground
   direction the moment the camera entered the scene.

Splitting them matters: (1) failing means turn up the contrast; (2) failing is structural and
is what the minimap exists for. Conflating them would send the 5.4 design chasing the wrong
fix. Cost: hours, against the whole of 5.4.

A "no" on (2) is information, not failure — it says the minimap is load-bearing rather than
decorative, and may say it should lead the design instead of being an inset. Better learned
here, while `cityscape` is still unwritten.

## 5.4 — `packages/skins/cityscape`

The deliverable. Reuses `tiles3d`'s extrusion geometry and beacons; adds movement.

- `camera: "fly"` / `"walk"`, switchable. `FlyControls` for travel, `PointerLockControls` for
  street level. `navigate()` maps `focus`/`drill` → `walk-to`, `trace` → `fly-path`.
- Materials read `geometry-3d.css` tokens (`--face-*`, `--geo-specular`, `--geo-ao`,
  `--geo-edge-hot` for risk) — **not** hardcoded colours. This is what keeps 2D and 3D reading
  as one product.
- Ground plane from `--grid-cell`/`--grid-line`, matching the 2D canvas grid.
- Streets are the routing channels (`serve.md#6`, "streets come free") — already in
  `SceneLink.path`.
- **Hue massing is the landmark, regions are the bonus.** The city reading is: a building =
  one unit (height `depth`/sloc, footprint area, shape complexity), and its hue = its layer.
  A cluster of same-hue buildings is a quarter you can see from a distance and steer toward —
  and unlike a region box, that cluster exists in *every* view. Make layer hue read strongly
  at distance (saturated facades, not subtle tints); this is the cheapest real wayfinding win
  and it needs no new scene data.
- Regions (`region.ts`, which `tiles3d` lacks) render as ground decals or low walls where they
  exist — but they are **not** load-bearing for wayfinding, because they often don't exist:
  `layout.ts:74` drops any group with fewer than 2 distinct layers on screen, and
  `flowchart.ts:201`/`nested.ts:49` return `regions: []` outright. On `fixtures/orderly`'s
  system view that means 2 regions spanning 5 of 9 layers, with 4 layers in none. A skin that
  leans on district boxes for orientation goes blind exactly where they're absent.
- Note regions are keyed on `group` (a layer's `group` field), not on `layer` — one region can
  contain several hues. Don't render them as if they were a single layer's colour.
- `blockType` diamonds: `tiles3d` ignores these. Handle or document as out of scope.

**Wayfinding — the real design risk.** `serve.md`'s core rule is *"if a viewer cannot state
what an axis means, the layout has failed."* At street level, rank stops being visible: it
becomes a direction you walk, not something you see. `serve.md#6` mandates the mitigations —
a top-down 2D minimap always on screen, non-focused buildings translucent, risk beacons above
the roofline (already built, `tiles3d/src/node.ts:53-61`). **Whether that is sufficient is
unproven.** Build the minimap in this step, not later; it is load-bearing, not polish.

**Risk: medium-high** — mostly design risk, not engineering risk.

## 5.5 — The switch

- Rename `App.tsx`'s existing `skin` (`:302-308`) → `theme`; add `renderSkin` to the store.
- `SegmentedControl` — Tiles / Tiles3D / Cityscape. `App.tsx` picks `CanvasHost` or
  `Canvas3dHost` by `skin.camera`.
- Switching must preserve `selection`, `focus`, and `focusStack`.

## 5.6 — Docs

`README.md` (`tiles3d` row: `Built, unwired` → wired; add `cityscape`), `docs/serve.md:158-166`
(status note; add `cityscape` to the skin list), and the Wave 5 section of
`remediation-security-clustering-canvas-docs.md` → resolved, pointing here.
Supersede `docs/plans/wave-5-skin-contract.md` — its "recommend archiving `tiles3d`" is
overtaken by the decision to build the 3D view; replace it with this plan's content.

---

## Sequencing

```
5.1 ──► 5.2 ──► [CHECKPOINT] ──► 5.3 ──► 5.4 ──► 5.5 ──► 5.6
```

**PR 1 `refactor/skin-contract-seam`** (5.1 + 5.2) — the contract is real and the 2D view
routes through it. No visible change. Independently valuable and independently revertible.

**CHECKPOINT 1.** Last cheap exit; first point where 5.2's true difficulty is known.

**PR 2 `feature/3d-host`** (5.3) — WebGL on screen, `tiles3d` reachable.

**CHECKPOINT 2 — the wayfinding look.** Street-level camera on the real fixture, before
`cityscape` is written. This is the checkpoint that matters most: it is the only one that
tests the plan's largest risk, and it is deliberately placed before its most expensive step.

**PR 3 `feature/cityscape-skin`** (5.4 + 5.5 + 5.6) — walk/fly, minimap, switch, docs.

---

## Verification

Per PR: `npm test` (756 baseline at the start of Wave 5, green) and `npm run lint`.

- **5.2:** 29 `CanvasHost` tests green, plus the new encoding-channel tests. Any test that
  needed editing is justified in the PR description as cosmetic. Screenshots of Current and
  Delta as a reviewer aid.
- **5.3 / 5.4:** jsdom has no WebGL, so test the **object graph**, not pixels — the pattern
  `tiles3d/test/node.test.ts` already uses (asserts `Group`, geometry type, positions;
  never renders). Assert: group per unit named by id, `userData.sceneNodeId` set, material
  colour matches `hashLayerToColor`, disposal called on unmount, `navigate()` returns the
  right `CameraMove` per intent. Raycasting math is testable headless (fixed camera, known
  ray, expected hit).
- **Manual, `npm run dev` against `fixtures/orderly`:** walk and fly through the scene; click
  a building selects it; double-click drills; minimap tracks position; toggle skins 20× and
  confirm no WebGL context warnings and no memory growth; 2D view unchanged.

**Done when:** three skins switch in the toolbar; the 2D view keeps every encoding channel and
interaction it has today; the 3D view is labelled, layer-coloured, delta-aware, walkable and
flyable, with a working minimap; no leaked contexts; docs updated.

---

## Risks, ordered

| Risk | L×I | Mitigation | Early warning |
|---|---|---|---|
| **Wayfinding fails** — rank invisible at street level. *The largest risk in this plan: nothing tests it, the prescribed mitigations are unproven, and it is structural — entering the scene inherently costs you the axis you read at a glance in 2D.* | M×H | **Checkpoint 2** answers it cheaply in 5.3, before `cityscape` is written; then minimap in 5.4, not deferred; translucency; beacons | Standing between two buildings, you can't say which way is "up the dependency graph" |
| **5.2 loses an encoding channel or interaction** | M×H | New per-channel tests; 68 existing tests; checkpoint | A delta state or hue stops rendering |
| **WebGL context leaks** on skin toggle | M×M | Explicit geometry+material disposal; toggle test | Console context warnings; memory climbs |
| **`skins/tiles` gains React dep** | H×L | Accepted deliberately (Decision 2) | — |
| **`cityscape` scope creep** | M×M | Reuse `tiles3d` geometry; regions/diamonds explicitly cut if needed | 5.4 outgrows 5.1–5.3 combined |
| Label legibility at distance | M×M | `CSS2DRenderer` + distance-based culling | Overlapping labels in dense areas |
| Raycast misses small nodes | L×L | Group-level `userData`, not mesh-level | Clicks select the wrong unit |
| Performance | L×L | 105–400 nodes; not a real risk at this scale | — |

---

## Corrections to the earlier Wave 5 scoping

`remediation-security-clustering-canvas-docs.md:720-758` was written from the Wave 4 log
without re-reading the renderers. Three claims don't hold:

1. **"5.2 is a refactor; the 2D path must come out pixel-identical."** There is no single 2D
   renderer to refactor — `tiles/src/node.ts` and `CanvasHost.tsx` draw different tiles from
   the same scene. Pixel-identity is only reachable in the direction *app → contract*.
2. **"`packages/ui` does not depend on `three`."** True of `package.json` only; `three` and all
   camera controls are already hoisted. The dependency is one line.
3. **"skin persisted like other UI prefs."** No persisted prefs exist — no `localStorage`, no
   `persist` middleware.

Also corrected from my own earlier analysis: I claimed `tiles3d` "cannot express layer hue or
unit names." Wrong diagnosis — `SceneNode` already carries `name` and `layer`; `tiles3d` just
doesn't read them. And `geometry-3d.css` means the design system already ships a 3D light rig,
so those materials are not being invented from nothing.

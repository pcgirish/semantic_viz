# Group layers into architectural groups, and render region boxes around them

## Context

User compared the live UI against an older mockup
(`project_viz/docs/mockup/phase0-review-map-v3.html`) and its zoom-level screenshots.
Two gaps were raised:

1. **Module grouping looks unsatisfactory.** The user's own diagnosis, confirmed by two
   rounds of investigation this session: Pass B/C already clusters files into `layer`
   units (e.g. ~40 fine clusters for this repo) that are semantically the *next* level
   down from the mockup's regions — the LLM is "giving the next layer of modules as the
   root layer." There is currently no super-grouping step that buckets those layers into
   a small number of named architectural groups (mockup: `API SURFACE`, `CORE DOMAIN`,
   `PLATFORM`, `EXTERNAL SYSTEMS`; this repo's natural equivalent: `server`,
   `interpreter`, `extractor`, `differ`, `skins`, per the top-level `packages/*` split).
   Confirmed via schema audit: `Unit` has zero cross-cutting grouping field — only
   `parent`/`children` (`packages/schema/src/index.ts:96-117`), and every `layer` is
   created as a direct, flat child with no bucket
   (`packages/interpreter/src/orchestrate.ts:124-161`).
2. **Function-internal flowcharts** (mockup's `create_order()` flowchart with decision
   diamonds) — explicitly out of scope for this plan. It requires new AST-level
   extraction (control-flow inside function bodies) and a new interpreter pass; today's
   extractor only captures function-to-function call edges
   (`packages/extractor/src/walk-typescript.ts:102-135`, `collectRefs` looks only at
   `call_expression`). This is data/extraction work, not UI, and is being tracked
   separately — not part of this plan.

This plan has three parts: **Part A** adds the missing grouping data (a `group` field on
`layer` units, populated by a small new interpreter pass — cheap, since Pass B/C already
has the exact cluster names + files this needs as input). **Part B** is presentation-only:
render a dashed, labeled region box per group on the canvas, reusing the existing per-layer
color hashing (`hashLayerToColor`) so no new visual language is introduced. **Part C** is
also presentation-only: restructure the left rail (today a flat list of layer chips) into
group header rows with their member layers as indented sub-bullets — matching the user's
explicit ask to take the mockup's *functionality*, not its palette.

## Part A — group layers into architectural groups

### Interpreter: new grouping step after Pass C
Add a new step in `packages/interpreter/src/orchestrate.ts`, right after `runPassC`
(line 132), following the same propose-then-repair discipline already used for Pass B
clusters and flow entry points (`packages/interpreter/src/checker.ts`,
`proposeFlowEntryPoints` in `pass-c.ts:91-103`):

- **Input**: the layer names + `what`/`why` semantics already produced by Pass C
  (`passC.layers`, each has `name`, `files`, `what`, `why`) — no new extraction, this data
  already exists in memory at this point in `orchestrate.ts`.
- **LLM call**: propose a small number of named groups (target ~3-6, mirroring the
  mockup's 3-4 clusters) and assign every layer name to exactly one group. New prompt file
  `packages/interpreter/src/prompts/pass-c-groups.ts`, modeled on
  `packages/interpreter/src/prompts/pass-b.ts` (which already does "propose a small
  number of named buckets over a set of names" for files → clusters; this is the same
  shape one level up: layers → groups).
  Response shape: `{ "groups": { "api surface": ["layerNameA", "layerNameB"], ... } }`.
- **Repair**: any layer name in the response that isn't among the actual Pass C layer
  names gets dropped, and any layer left unassigned falls back into a catch-all group
  (e.g. "other") — same defensive pattern as `checkAndRepairClusters`. Do not fail the
  whole snapshot if the LLM group proposal is incomplete.
- **New function**: `runPassCGroups` (or fold into `pass-c.ts` as another exported
  function, consistent with how `proposeFlowEntryPoints`/`narrateFlow` already live
  alongside `runPassC` in the same file) taking `{ layers: Layer[], provider, promptRev }`
  and returning `Record<string, string[]>` (group name → layer names), then repaired
  against known layer names before use.

### Schema: `group` field on layer units
Add `group: string | null` to `UnitSchema` in `packages/schema/src/index.ts` (near
`parent`/`children`, since it's the same kind of structural metadata). `null` for every
non-`layer` unit; for `layer` units, the group name resolved from the repair step above.
This is additive — no migration concerns since snapshots are regenerated, not migrated
(confirm by checking whether existing `.scv/snapshots/*.json` are consumed by anything
that would break on an unknown-but-optional field; Zod's default parsing already tolerates
new optional fields on read as long as `group` is `.nullable()` with a sensible default for
old snapshots).

### Orchestrate: set `group` when constructing layer Units
In the `newUnits.push({...})` block for layers (`orchestrate.ts:139-160`), set
`group: groupByLayerName.get(layer.name) ?? null` using the repaired map from the new
grouping step.

## Part B — render region boxes (per group, not per layer)

Note: this supersedes an earlier draft of this plan that grouped by `layer` directly —
with Part A in place, regions should be drawn **per `group`**, one level up from `layer`,
so the region boxes match the mockup's coarse 3-6 cluster count instead of ~40 boxes.

### 1. `packages/layout/src/scene.ts` — add `SceneRegion`
```ts
export type SceneRegion = {
  id: string;      // group name, stable slug
  name: string;     // group display name, for the label
  x: number; y: number; w: number; h: number; // bounding box, scene units
};

export type Scene = {
  nodes: SceneNode[];
  links: SceneLink[];
  regions: SceneRegion[];
};
```
Also add `group: string` to `SceneNode` (mirrors the existing `layer: string` field,
`scene.ts:18`) — resolved the same way `layerIdOf` resolves `layer` today.

### 2. `packages/layout/src/layout.ts` — compute regions in `buildScene`
After `nodes` is built (which already carries `layer` per node, line 90-111), also resolve
each node's `group` the same way `layerIdOf` resolves `layer` (walk the parent chain to the
nearest `layer` ancestor, then read that layer unit's `group` field from Part A). Group
nodes by non-empty `group` name and take the bounding box (min/max x/y+w/h) of each group's
member node boxes, padded by a constant (reuse the same `pad` convention CanvasHost uses
for scene bounds, e.g. 16-24 units). Nodes with no group (ungrouped layers, externals, or
non-layer top-level children) produce no region.

Only compute regions when there's more than one node in the group (a single-node "cluster"
box would be visual noise, mirrors the mockup where every region has multiple plates).

### 3. `packages/skins/tiles/src/` — region renderer
Add `region.ts` exporting `region(r: SceneRegion): SVGGElement`: a dashed `<rect>` +
uppercase `<text>` label in the top-left corner, styled off the same `Theme` used by
`node.ts`/`link.ts` (check `theme.ts` for existing dashed/muted tokens before inventing
new ones). Color: reuse `hashLayerToColor(r.id)` at low opacity for the stroke, consistent
with how tiles are already tinted per layer — do not introduce a separate palette (user
explicitly wants the mockup's *functionality*, not its visual style).

Export `region` from the skin's `index.ts` alongside `node`/`link` so `Skin` type gains an
optional `region?: (r: SceneRegion) => SVGGElement` member (`skin.ts:15-21`).

### 4. `packages/ui/src/CanvasHost.tsx` — draw regions
In the scene-build effect (`CanvasHost.tsx:76-125`), add a region layer **behind** the link
layer (regions must not intercept pointer events meant for tiles/links — set
`pointer-events: none` on the region group, consistent with `.region text{pointer-events:none}`
et al. in prior mockup CSS patterns already referenced in this repo's docs). Iterate
`scene.regions`, call `tilesSkin.region?.(r)`, append before `linkLayer`. No click/drill
behavior on regions themselves — this plan doesn't add region-level navigation (matches
mockup: regions group but don't drill).

### 5. CSS
Add region styles to `packages/ui/src/app.css` (or wherever tile/link styles already live)
following the existing dashed-border / uppercase-label conventions already used for
low-confidence/unanalyzed states, not the mockup's literal palette.

## Part C — left rail: group rows with layers as sub-bullets

Today's rail (`packages/ui/src/App.tsx:183-188`, `Legend.tsx`) is a flat list of one chip
per `layer`. Restructure `Legend.tsx` into a two-level tree using the same `group` field
from Part A: one row per group (bold/header style, colored via a group-level hash — reuse
`hashLayerToColor` keyed by group name, so it's visually distinct from individual layer
chips), with that group's member layers listed as indented sub-bullets underneath (existing
per-layer chip + color, unchanged).

- `Legend.tsx`: replace the flat `layers.map(...)` with `groupBy(layers, l => l.group ?? "other")`,
  render each group name as a row, then map its layers as nested `<li>`/`<div>` items below
  it, keeping the existing `hashLayerToColor(layer.id)` chip per layer.
- No new store state needed — this is a pure rendering change over data already passed in
  (`units` prop, `Legend.tsx:4-6`).
- Keep click-to-select/focus behavior on individual layer rows as it exists today, if any;
  don't add new interaction unless already present — verify current behavior in
  `Legend.tsx`/`App.tsx` before assuming none exists.
- CSS: indent sub-items, small font-size step-down, group header slightly bolder/larger —
  consistent with existing rail styles in `app.css`, not a new visual language.

## Testing (TDD)

- `packages/interpreter/test/`: new grouping step assigns every Pass C layer name to
  exactly one group; a layer name the LLM omits falls back to a catch-all group (repair
  behavior); a group name the LLM invents referencing an unknown layer is dropped, mirroring
  `checkAndRepairClusters`'s existing repair tests.
- `packages/schema/test/`: `UnitSchema` accepts `group: string | null`; parses old
  fixture snapshots that lack `group` without throwing (default/nullable).
- `packages/layout/test/layout.test.ts`: `buildScene` with 2+ layers sharing the same
  `group` produces one `SceneRegion` whose bounding box contains all member nodes' boxes
  plus padding; a group with only one member layer/node produces no region; units with no
  group produce no region; region `name` matches the group name.
- `packages/skins/tiles/test/`: `region()` returns an `SVGGElement` with the expected rect
  dimensions and a text label containing the region name.
- `packages/ui/test/App.test.tsx` or a new `CanvasHost` test: with a snapshot containing a
  multi-layer group, the rendered SVG contains a region group element positioned behind
  the node layer.
- `packages/ui/test/Legend.test.tsx` (new or extended): renders one header row per group
  with its member layers nested underneath; a layer with no group falls under an "other"
  header; existing per-layer chip color/name still present.

## Verification

1. `npm test` — new tests RED before implementation, GREEN after; full suite still passing.
2. `npm run lint`, `npm run build` clean.
3. Regenerate (or re-run interpreter over) `fixtures/orderly`'s `.scv/` snapshot so it picks
   up the new `group` field, then serve it and visually confirm via Playwright: left rail
   shows group headers with layers nested underneath; dashed region boxes with labels
   appear around grouped layer clusters in Current/Delta/Depends-on views (a handful of
   boxes, not ~40); tiles still click-select and double-click-drill exactly as before;
   regions themselves are inert (no click target); zooming/panning still works.
4. Confirm color/style stays consistent with the existing tile-color hashing — not a new
   visual language — matching the user's explicit ask ("get the functionality... not the
   color-visual-styles").

## Explicitly out of scope

- Function-internal flowcharts (mockup's `create_order()` decision-diamond view). Needs
  new extraction (control-flow AST walk) + new interpreter pass + new schema `block` unit
  usage (currently defined but never populated, `packages/schema/src/index.ts:15`) + new
  layout algorithm + new UI view. Large, separate effort — flag as a follow-up, not part
  of this change.
- A separate "Architecture" view/zoom-level/tab. The mockup's Architecture tab is not a
  new navigation mode here — Part B's region boxes drawn directly in the existing
  Current/Delta/Depends-on canvas **are** the architecture-level grouping. No new view,
  no new drill level, no new mode toggle.

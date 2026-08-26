# Give plates real visual signal: variable sides in Architecture view, fan-based sizing in both views

## Context

The user asked three questions about why the visualization currently reads as visually flat:

1. **Plate shape** — Module view already varies polygon sides by `apiCount` via
   `computeSides()` (`src/skin/plateSides.ts`), matching docs/design.md's Polygonal
   Plate Encoding ("number of sides: entity type, abstraction level, or interface
   shape"). Architecture view (`src/skin/renderArchitectureView.ts:45-50`) calls
   `skin.plate()` without a `sides` field at all, so every plate falls back to the
   skin's default rect — confirmed by reading the file directly. This is an
   inconsistency, not a documented design choice: nothing in design.md restricts
   side-count variation to Module view only.

2. **Layout** — Already left-to-right, already crossing-aware: both `layout.ts`
   (Module view) and `clusteredLayout.ts` (Architecture view, two-tier: per-domain
   layered layout + box-packed regions) use elkjs's `layered` algorithm with
   `elk.direction: "RIGHT"`, which is a Sugiyama-style layered+crossing-minimization
   layout — exactly "logical flow left-to-right" + "least crossings," not an either/or.
   Nothing to change here; this already matches design intent (decisions.md confirms
   elkjs was chosen for this reason). Positions are also persisted across renders
   (`mergeWithSavedPositions`) for a stable mental map. **No action item** — will
   report this to the user as already-solved rather than building anything.

3. **Plate dimensions** — `PLATE_WIDTH=160`/`PLATE_HEIGHT=60` are hardcoded constants
   in both `layout.ts` and `clusteredLayout.ts`; no entity ever gets a different size.
   This contradicts docs/design.md's own stated intent: "area: importance, usage, or
   fan-in/fan-out" and "thickness: complexity or size" (design.md ~line 554-559).
   `apiCount` is already spoken for (it drives sides) — fan-in/fan-out is the metric
   design.md names for area, and it's *not currently computed anywhere* (confirmed:
   no fanIn/fanOut/usageCount fields exist on `SemanticEntity.metrics` or
   `SemanticRelationship`). It's cheap to derive at layout time, since every layout
   call site already receives the full `relationships` array.

This closes a real gap between documented visual grammar and actual rendering,
using data already flowing through the layout functions — no new scanning/analysis
pipeline needed.

## What changes

### 1. Wire `sides` into Architecture view (`src/skin/renderArchitectureView.ts`)

Mirror `renderModulesView.ts`'s existing pattern exactly (lines 107-109, 133):
build a `sidesByEntityId` map with `computeSides(entity.metrics.apiCount ?? 0)` for
every entity with defined confidence, and pass `sides: sidesByEntityId.get(entity.id)`
into the `skin.plate()` call at line 45-50. Both skins (`skeletal.ts`, `technicalAtlas.ts`)
already handle `sides` correctly when present — confirmed by reading both — so this is
pure wiring, no skin changes.

Also apply the same polygon-aware edge clipping Module view already has
(`clipToPlateBorder`/`clipToPolygonBorder` from `plateSides.ts`) in place of
Architecture view's current `clipToRectBorder`, so edges terminate at the drawn N-gon's
border, not its invisible bounding box — otherwise edges will visibly float off
newly-non-rectangular plates.

### 2. Compute fan-in+fan-out and derive plate width/height from it

Add a small helper (new function in `plateSides.ts`, alongside `computeSides`, since
it's the same "map a count to a bounded visual dimension" shape) —
`computeFanDegree(entityId, relationships)`: count relationships where
`rel.from === id || rel.to === id`, excluding `test_coverage` (same exclusion both
layout files already apply for structural purposes).

Add `computePlateSize(fanDegree)` returning `{ width, height }`, keeping the existing
160×60 as the baseline/median size and scaling modestly around it (e.g. linear step
per fan-degree unit, capped) — same shape as `computeSides`'s linear-then-log-capped
approach, reusing that precedent rather than inventing a new curve. Exact constants
tuned against `fixtures/orderly`'s real relationship counts so common cases stay close
to today's 160×60 and only genuinely high-fan-out modules (hubs) visibly grow.

Wire this into both `layout.ts` (`layoutEntities`) and `clusteredLayout.ts`
(`layoutClusteredArchitecture`), replacing the constant `width: PLATE_WIDTH, height:
PLATE_HEIGHT` passed into elk's `children` with the per-entity computed size. Both
files already read `child.width`/`child.height` back from elk's result with a
`PLATE_WIDTH`/`PLATE_HEIGHT` fallback (`layout.ts:61-62`, `clusteredLayout.ts:123-124`)
— no change needed there, elk already supports per-node dimensions (confirmed:
`ElkNode.width`/`height` are already optional per-node fields, already populated
per-child today, just with a constant).

`clusteredLayout.ts`'s region bounding-box computation (lines 83-84,
`maxX`/`maxY` from `children.map(...)`) already reads `c.width ?? PLATE_WIDTH` /
`c.height ?? PLATE_HEIGHT` per-child rather than assuming the constant — so variable
sizes flow through region sizing correctly with no additional change.

### 3. Tests (TDD: failing tests first)

- `tests/plateSides.test.ts` (or extend if it exists): `computeFanDegree` — counts
  correctly, excludes `test_coverage`, handles an entity with zero relationships.
  `computePlateSize` — baseline case returns near-160×60, high fan-degree returns
  larger, capped at some max so it can't grow unboundedly.
- `tests/renderArchitectureView.test.ts` (or wherever Architecture view rendering is
  tested): plates now emit `<polygon` (not just default rect) when apiCount > 0;
  entities with different apiCount get different side counts; edges clip to the
  polygon border, not the bounding rect.
- `tests/layout.test.ts` / `tests/clusteredLayout.test.ts`: entities with more
  relationships get larger computed width/height than entities with fewer; sizes stay
  within sane bounds.
- Run existing `tests/shellPage.test.ts`, `tests/renderModulesView.test.ts` (if
  present) to confirm no regression to Module view's already-correct behavior.

### 4. `docs/decisions.md`

Append one entry: Architecture view's plates now vary sides (via the same
`computeSides(apiCount)` Module view already uses) and both views' plate width/height
now derive from fan-in+fan-out degree instead of a fixed constant — closing the gap
between design.md's documented Polygonal Plate Encoding intent and actual rendering.
Note layout algorithm (elkjs layered, left-to-right) was already correct and
unchanged.

## Verification

- `npm test`, `npm run lint`.
- Manual: `npm run dev` / `scv serve fixtures/orderly`, view Architecture — confirm
  plates now render as varied N-gons (not uniform rects) and edges touch the polygon
  border cleanly. Compare a hub module (high fan-degree) vs a leaf module — hub should
  visibly render larger.
- Manual: Module view — confirm no visible regression (sizes should stay close to
  today's for typical fan-degree, per the fixture-tuned constants).

## Out of scope (reported to user, not actioned)

- Layout algorithm/ordering — already left-to-right + crossing-minimized via elkjs
  layered layout in both views; no change needed.

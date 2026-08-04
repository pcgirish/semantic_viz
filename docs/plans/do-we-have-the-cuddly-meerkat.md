# Visualization Fixes & Compact Hop-Column Redesign — Sequenced Plan

## Context

Three separate problems surfaced while reviewing the current views, in this order:

1. Raising the polygon-side floor from 3→4 was meant to make low-`apiCount`
   plates render as plain rectangles. It didn't — 4-sided plates still render
   as diamonds, and some labels spill past the shape's slanted edges.
2. A large fraction of functions/entities in the drill-down view (e.g.
   `backend/services`) show no call edges at all, even when they plainly call
   each other in the source — traced to a real gap in call-resolution, not an
   inherent limit of static analysis.
3. The user wants a codeviz-style compact presentation (entry-point sidebar +
   hop columns + file-grouped symbol rows) for API Flow and User Journey.
   Confirmed via mock: https://claude.ai/code/artifact/608e2f2b-54a0-4d7b-984f-0fcb73c953e4
   Call Graph is still an open question for this pattern — not yet scoped in
   or out; needs its own investigation before deciding.

These are ordered as a single sequence because #1 and #2 both change what the
*current* views render (shape, and which edges even exist), so fixing them
first means the later Call Graph investigation and the hop-column redesign are
both judged against correct visuals, not artifacts of these two bugs.

## Step 1 — Plate shape/sizing bug (small, independent)

**Root cause A — diamonds, not rectangles, at 4 sides.**
`regularPolygonPoints` (`src/skin/plateSides.ts:137`) inscribes every N-gon
with its first vertex pointing straight up (`angle = -Math.PI/2 + ...`). For
`sides = 4` that places vertices at top/right/bottom/left — a diamond by
construction, for any width/height. There is no rotation that makes a regular
4-gon axis-aligned like a rectangle from this formula; raising
`MIN_PLATE_SIDES` to 4 could never have produced a rectangle.

**Root cause B — text spills past the polygon's slanted sides.**
`computePlateSize` (`plateSides.ts:125`) sizes the plate's *bounding box* to
fit the label (`minWidthForLabel`), but a non-rect polygon's usable interior is
narrower than its bounding box away from the vertical center — a diamond's
horizontal width shrinks to zero at top/bottom. A label rendered at vertical
center still overflows visually once the shape's sides slant inward from the
box edge.

**Fix:**
- Add an explicit rect case: when `sides === 4` (or more precisely, whenever
  `MIN_PLATE_SIDES` calls for the floor), render an axis-aligned rectangle,
  not a rotated regular polygon. This matches the original intent ("4 should
  look like a normal rectangle") directly, and keeps `computeSides` untouched
  (`sides >= 5` still renders as a true polygon, where the diamond-vs-rect
  distinction doesn't apply the same way).
- For polygons with `sides > 4`, keep bounding-box label sizing as-is (already
  looks acceptable per the screenshot — the spillover is specifically visible
  on diamonds); revisit only if the rect fix doesn't also resolve it in
  practice.
- Touches: `src/skin/plateSides.ts` (`regularPolygonPoints` or a new
  `rectPoints` path), `src/skin/skeletal.ts`'s `plate()` (the `sides !==
  undefined` branch at `skeletal.ts:65`, calling `regularPolygonPoints`).
- TDD: RED test asserting a `sides: 4` plate's SVG points form an axis-aligned
  rect (4 corners, not top/right/bottom/left diamond vertices).

## Step 2 — Call-resolution gap: instance-attribute receivers dropped (small, independent)

**Root cause.** `extractCalls` (`src/scanner/pythonParser.ts:388`) only
records a cross-symbol call for two receiver shapes:
- `self`/`cls` (`SELF_RECEIVERS`, line 345) → treated as in-file.
- A receiver bound by a top-level `import`/`from...import` in the same file
  (`importedNames.has(receiver)`, line 432).

A call through a **constructor-injected or attribute-held collaborator** —
`self._repo.fetch_active()` where `_repo` is an instance attribute, not an
import — has receiver `"_repo"`, matches neither branch, and is silently
dropped (falls through both `if`/`else if` with no `push`). This is exactly
the shape in the `backend/services` screenshot: `get_or_seed`,
`_fetch_active`, `_fetch_by_name`, `invalidate_cache`, `_seed`,
`reset_to_defaults` are repo/cache-style methods almost certainly called
through a held instance, not a bare import — so they show zero edges even
though real calls reach them.

**Fix approach (needs a design decision, not just a patch):** resolving
`self._repo.fetch_active()` to a target file requires knowing what `_repo` is
bound to — typically assigned in `__init__` from a parameter or a constructed
instance (`self._repo = repo` or `self._repo = SomeRepo()`). This is a real,
scoped extension to `extractCalls`/`resolveReceiver`, similar in spirit to the
existing import-binding resolution:
- Collect `self.<attr> = <expr>` assignments inside `__init__`.
- If `<expr>` is a bare name matching a constructor parameter, and that
  parameter is untyped (common in Python), exact resolution isn't always
  possible from syntax alone — needs a decision on how far to go (e.g. only
  resolve when `<expr>` is a direct call to a known local class name, or
  when a type annotation is present).
- Where resolution truly isn't possible from static syntax, this is an honest
  boundary (matches the existing "dropped rather than guessed at" policy) —
  the difference from today is that a same-file/known-class case will now
  resolve instead of universally dropping every non-import receiver.
- Touches: `src/scanner/pythonParser.ts` (`extractCalls`, `calleeOf`, receiver
  resolution), possibly `src/scanner/symbolScene.ts`'s `resolveReceiver` if
  attribute bindings need to flow into module-hop resolution too.
- TDD: RED test with a fixture class using `self._repo = repo` in `__init__`
  and a method calling `self._repo.fetch_active()`; assert the call edge
  exists once attribute-receiver resolution lands. Precise resolution rule
  (parameter-name match vs. constructor-call match vs. type-annotation) to be
  finalized during implementation — flag remaining unresolvable cases as
  correctly-dropped, not a bug.

## Step 3 — Call Graph: investigation complete, folds into Step 4

**Decided: approach (a), entry-point-rooted hop columns.** Measured against
real repo data (after Steps 1–2's fixes, so the graph wasn't distorted by the
edge-dropping bug):
- 126 entities, 82 call edges, 13 chains + 51 genuinely isolated entities
  (correctly so — leaf/utility functions with no in-repo callers or callees,
  same honest-boundary pattern Step 2 investigated).
- The two largest chains (36 and 12 nodes) are **multi-rooted**: the 36-node
  chain alone has 8 in-degree-0 roots, mostly route handlers whose call trees
  converge downstream on shared helpers (e.g. multiple routers calling into
  `llm_service.py`). This is exactly what hop-columns-from-an-entry-point
  splits apart naturally, without inventing a new visual language.
- **No new entry-point detection system needed for the bulk of it**:
  `routeScene.ts` (`src/scanner/routeScene.ts:16`) already resolves every
  route to its exact handler `function_group` id (`handlerPath`) — 6 of the 8
  roots in the size-36 chain are already-known route handlers. Reuse that
  resolution directly as Call Graph's entry-point set.
- **Remaining gap: CLI entry points** (`scripts/generate_problem.py#main`,
  `scripts/reset_eval_criteria.py#main` — 2 of 8 roots). Small, cheap
  heuristic: a top-level `def main():` in a scanned file counts as an entry
  point. Does not need general "exported/public function" detection.
- **Isolated entities (51/126)** aren't entry points and have no hop chain —
  keep them out of the sidebar; either omit them from Call Graph's compact
  view entirely (they're leaves, already visible in the drill-down/Modules
  view) or keep today's grid-footer treatment as a secondary section below
  the sidebar+columns area.

**Conclusion: Call Graph is in scope for Step 4**, not deferred. Its
entry-point set is {routes (existing `routeScene.ts` data) ∪ CLI `main()`s
(new, small)}; its hop traversal reuses the same BFS-over-`call`-edges
approach already built for `apiFlowLayout.ts`.

## Step 4 — Compact hop-column layout for API Flow, User Journey & Call Graph

API Flow currently renders one full-size plate per entity
(`renderApiFlowView.ts`), laid out one row per route (`apiFlowLayout.ts`,
already shipped). A real route (10+ symbols, 5 files) still wraps across
several rows, and the file a symbol lives in is only a small corner label.
Redesign: left sidebar listing entry points (routes, journeys, and now call
graph entry points), single-selection focus, selected entry's reachable
graph laid out left-to-right as hop columns, each column holding compact
file-grouped boxes (stacked `ƒ symbolname` rows) instead of one plate per
symbol. Mock: https://claude.ai/code/artifact/608e2f2b-54a0-4d7b-984f-0fcb73c953e4

**In scope: API Flow, User Journey, Call Graph** (Step 3 concluded Call Graph
fits this pattern — see above). Call Graph's sidebar groups entry points by
kind (Routes / CLI), same idea as the codeviz reference screenshot's
Public API / HTTP Routes / CLI grouping — reuse `routeScene.ts`'s existing
route→handler resolution for the Routes group; add a small `main()`-detection
step for the CLI group. Isolated (no-edge) entities are not entry points and
are omitted from Call Graph's sidebar — they remain visible via Modules/drill-down.

### 4a. Sidebar + single-selection — page-level concern, not a skin concern

Sidebar (route/journey list, filter box, one active at a time) is DOM/JS in
the page shell (`src/skin/shellPage.ts`, which already carries other
client-side scripts — task chip, mode toggle, author filter), not inside the
SVG or `skeletal.ts`. Server-side view functions gain a required "which
entry" parameter and render one entry's hop-graph per call.
- `?entry=<id>` query param (mirrors existing `?skin=`); default to the first
  entry so the view never renders empty.
- Sidebar data (route/journey ids + labels) supplied via whatever mechanism
  already feeds other page chrome — don't invent a second one.

### 4b. File-grouped hop columns replace one-plate-per-symbol

Grouping by file is a data-shaping decision upstream of the skin, not a new
`Skin` primitive — per `interface.ts`'s "skins change presentation only"
comment, the skin still only draws plates/text; a "grouped box" is several
text rows drawn inside one outer rect, computed before it reaches the skin.
- Group entities reachable at hop N by `entity.files[0]` (`function_group`
  entities already carry `files`; `semanticEntity.ts:20`).
- One outer rect per (hop, file) group, sized to fit N stacked rows (extend
  `computePlateSize`'s math for a row count, not a single label).
- Each symbol row keeps its own `confidence`/`hop` — low-confidence symbols
  stay individually hatched/tinted inside the group (invariant: low
  confidence never absorbed into a group average).
- Connectors: one edge per **symbol-to-symbol** relationship, not
  file-to-file (mock's post-review fix). Same `EdgeSpec`/`clipToRectBorder`
  approach, anchored to a row's position within its group box.

### 4c. `apiFlowLayout.ts` — extend, not replace

`layoutApiFlow` (`src/skin/apiFlowLayout.ts:56`) already does
route→BFS→per-row ELK layout. Single-entry-selected view: drop the
`for (const route of routes)` outer loop — caller passes one route. Group
entities by `(hop, file)` before building the ELK graph so a group is one ELK
node, not N. `layoutChain` (`apiFlowLayout.ts:31`) needs a variant taking
pre-grouped nodes with multi-row heights instead of one label per node.

### 4d. User Journey — data restore, then reuse the same layout

`buildJourneyScene` (`src/scanner/journeyScene.ts:10`) must stop flattening:
return per-journey `{ journeyId, journeyLabel, entities, relationships }`
groups instead of one pooled result. `renderUserJourneyView.ts` takes one
journey's group (via the same `?entry=` param) and reuses the grouped-hop-
column layout from 4b/4c. A journey step has no `files`, so grouping is by
the step's `routes` field (`journeyScene.ts:43`) instead of by file; one
column per step position — steps are already ordered, no BFS needed, since
`user_transition` edges are already linear per journey.

### 4e. Call Graph — route entry points + in-degree-zero fallback

`layoutCallGraph`/`renderCallGraphView.ts` are replaced by the same
single-entry hop-column path as API Flow, rooted at the union of:
- Every route's resolved handler (`routeScene.ts`'s `handlerPath` /
  `RouteScene`'s route→handler mapping) — already-persisted data.
- Every symbol with no incoming `call` edge (`findInDegreeZeroEntryPoints`,
  `src/scanner/callGraphEntryPoints.ts`) — a pure projection over the
  already-persisted `symbols` layer, no live scan. This is what makes Call
  Graph usable in a repo with no HTTP routes at all (a pure library/script
  repo), and it subsumes CLI `main()` detection for free: nothing calls
  `main()`, so it's already in-degree-zero.
- A symbol that is *also* never the source of a call (fully isolated, no
  chain to render) is excluded from the entry-point list even if it's
  in-degree-zero — nothing to draw a hop chain from.

`findCliEntryPoints` (file-level `def main()` detection) is implemented and
tested but **not wired in** — in-degree-zero detection already covers its
case, so it would be redundant, not a gap. Kept as a documented, tested
utility in case a future need (e.g. distinguishing "CLI" from "library
root" in the sidebar's grouping) wants the more specific signal.

### Files touched (Step 4)

- `src/server.ts` — `?entry=` handling for api-flow-view/user-journey-view/
  call-graph-view; sidebar data wiring, grouped by kind for Call Graph
  (Routes / CLI).
- `src/skin/apiFlowLayout.ts` — single-entry mode; group nodes by `(hop, file)`;
  generalize so Call Graph and Journey can reuse the same grouped-layout core
  (a route is just one kind of entry point among several now).
- `src/skin/renderApiFlowView.ts` — grouped file-boxes + symbol-to-symbol
  connectors.
- `src/scanner/journeyScene.ts` — per-journey groups instead of flat pool.
- `src/skin/renderUserJourneyView.ts` — consume one journey group, reuse
  grouped hop-column layout/render path (extract shared logic, don't
  duplicate).
- `src/skin/renderCallGraphView.ts` — consume one entry point's hop chain,
  same reuse.
- `src/scanner/callGraphEntryPoints.ts` (new) — `findCliEntryPoints` helper;
  combine with route handlers into Call Graph's entry-point list.
- Tests: `tests/apiFlowLayout.test.ts`, `tests/renderApiFlowView.test.ts`,
  `tests/journeyScene.test.ts` (new), `tests/renderUserJourneyView.test.ts`
  (new/extended), `tests/callGraphEntryPoints.test.ts` (new),
  `tests/renderCallGraphView.test.ts` (extended).

## Verification (applies per-step)

1. TDD RED→GREEN per step/slice; `npm run verify` clean after each.
2. Steps 1–2: `scv serve` on a spare port (never the user's own 4173) —
   visually confirm plates render as expected rects at 4 sides, and the
   `backend/services` drill-down shows the previously-missing edges.
3. Step 4: selecting each route/journey/call-graph-entry in the sidebar
   renders only that entry's hop-column chain, symbols grouped by file,
   low-confidence rows still individually hatched, connectors symbol-to-
   symbol. Call Graph's sidebar shows Routes/CLI groups; isolated entities
   are absent from it. Compare against the approved mock for layout/spacing/
   connector intent, not pixel-identical.

## Branching

Each step is independent enough to branch/PR separately, in this order:
1. `fix/plate-shape-rect` — small, single-spot → ask "review, or merge
   directly?" per project convention.
2. `fix/call-resolution-instance-attrs` — small-to-medium depending on
   resolution-rule scope decided during implementation → likely warrants
   review given it changes graph *data*, not just rendering.
3. Call Graph shape — investigated (see above), folded into Step 4, no
   separate branch.
4. `feature/hop-column-flow-journey` — multi-file, new layout behavior across
   three views (API Flow, User Journey, Call Graph) → full review pass
   (`project-review` skill), not merge-directly.

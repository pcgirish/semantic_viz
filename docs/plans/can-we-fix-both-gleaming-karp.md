# Fix grammar-key legend fidelity + plate side-count encoding

## Context

Comparing `docs/mockup/phase0-review-map-v3.html` against the real app (`src/skin/shellPage.ts` + `src/skin/skeletal.ts`/`technicalAtlas.ts`) surfaced two divergences from the spec in `docs/design.md`:

1. **Grammar key legend** (`docs/design.md` calls this out via the mockup's `#legend`) does exist in `shellPage.ts:782-795` — it was NOT skipped, contrary to my first pass. But it was ported as a reduced, static, text-only panel: the header never shows which skin is active (mockup: `"Grammar key · " + sk.name`; real: hardcoded `"Grammar key"`), and rows dropped the mockup's inline SVG glyph swatches (plate polygon, aura colors, ghost/removed, dashed-low-confidence, hatched) plus the dynamic peg/socket connector rows (`sk.legendPeg`/`sk.legendSocket`), collapsing everything to plain sentences. Result: the "key" no longer visually demonstrates the encodings it claims to explain, and looks different from the mockup's for reasons beyond intentional restyling.

2. **Plate side count**: `docs/design.md`'s Base Visual Grammar spec (lines 501-506, 552-555) calls for polygonal plates that can be "triangular, quadrilateral, pentagonal, hexagonal, or irregular," with **number of sides meant to encode entity type, abstraction level, or interface shape** — i.e., something related to API/function surface, matching your recollection. What was actually built (`src/skin/interface.ts:38,153`, `src/skin/skeletal.ts:57-88`, `src/skin/technicalAtlas.ts:56-89`) is a hardcoded binary: `shape?: "rect" | "diamond"`, only ever set by `renderCodeFlowchartView.ts:78` (`nodeKind === "decision" ? "diamond" : "rect"`) — a flowchart decision-node convention, unrelated to API count. Modules/Review views (`renderModulesView.ts:106-113`, `renderReviewView.ts`) never set `shape` at all, so every module plate renders as the same fixed 6-point shape. No side-count-from-API-surface logic exists anywhere, and no entity field currently holds an API/function-call count — though `SemanticEntity.symbols: string[]` (`src/scanner/semanticEntity.ts:21,102`) already has the raw material (one entry per function/method) to derive one, via `module.symbols.length`, with zero new scanner work.

Both are real, separable gaps. Per project convention (`CLAUDE.md`), each gets its own branch, TDD red-green-refactor, and a review pass before merge.

---

## Branch 1: `fix/legend-grammar-key-fidelity`

**Goal:** make the real legend show the same encodings, with the same visual swatches, that it claims to key — and swap its header per active skin, matching the mockup.

**Scope:**
- `shellPage.ts:784`: header becomes `` `Grammar key · ${activeSkin === "technical-atlas" ? "Technical Atlas" : "Skeletal"}` `` (reuse the existing `otherSkin`/`SkinName` display-name mapping already at `shellPage.ts:778`, don't invent a second name table).
- `shellPage.ts:786-793`: replace plain-text rows with rows carrying a small inline SVG swatch + label, mirroring mockup rows at `phase0-review-map-v3.html:312-319` one-for-one:
  - plate = module/unit (swatch: a plain plate polygon outline)
  - green aura = added / amber aura = modified (swatch: aura stroke sample, reuse `CHANGE_AURA_COLOR` from `src/skin/tokens.ts` so this can't drift from the real render colors)
  - ghost = removed (swatch: `REMOVED_GHOST_FILL` fill + dashed stroke)
  - dashed outline = low confidence
  - hatched = unanalyzed (swatch: `fill="url(#hatch)"` — needs the `#hatch` pattern def available; currently only defined inline in the mockup's `<defs>`, so add an equivalent minimal `<pattern id="hatch">` def to the legend's own inline SVG rather than depending on view-specific `<defs>`)
  - keep existing rows that already have no visual equivalent to add (domain tint, author circle, risk flag, test-coverage dashed edge, hover hint) as text-only, since the mockup itself renders some of these as text too — only add swatches where the mockup has one.
- Do **not** port the mockup's peg/socket dynamic legend rows (`#lg-peg`/`#lg-socket`, `sk.legendPeg`/`sk.legendPeg`) — those require adding two new methods to the `Skin` interface (`src/skin/interface.ts:156-169`) purely for legend rendering, which is a larger interface change than "make existing rows accurate." Flag this as a follow-up, not in scope here.
- Since `skeletal.ts` and `technicalAtlas.ts` share the same modifier-class vocabulary (confirmed: both compute `d-added`/`d-modified`/`d-removed`/`lowconf` identically), one shared legend body works for both skins — no per-skin row branching needed beyond the header text.

**Files touched:** `src/skin/shellPage.ts` only (legend markup + header string). No changes to `skeletal.ts`/`technicalAtlas.ts` render logic — pull their existing color tokens from `src/skin/tokens.ts` for the swatches instead of duplicating hex values.

**Tests (TDD red-green-refactor, per project-testing skill):**
- New/updated test asserting `shellPage({..., activeSkin: "technical-atlas"})` output contains `"Grammar key · Technical Atlas"`, and the skeletal-default case contains `"Grammar key · Skeletal"`.
- Assert legend body HTML contains an `<svg>`/`<polygon>` (or similar) for at least the plate/aura/ghost/hatched rows, not just plain text — regression guard against re-flattening to text-only.

**Verification:** `npm test`, `npm run lint`, then `npm run dev` and visually diff the rendered legend against `docs/mockup/phase0-review-map-v3.html`'s in a browser for both `?skin=skeletal` (default) and `?skin=technical-atlas`.

---

## Branch 2: `feature/plate-sides-by-api-surface`

**Goal:** make plate side count reflect entity API/function surface, per `docs/design.md`'s Polygonal Plate Encoding spec, replacing the current rect/diamond binary for module plates (flowchart's decision-diamond usage is untouched — it's a distinct, already-correct convention).

**Side-count formula (confirmed):**
```
sides = clamp(3 + floor(log2(1 + apiCount)), 3, 8)
```
i.e. 0-1 symbols -> triangle, doubling roughly every extra side, capped at octagon — avoids a 200-function module needing a 200-gon. `apiCount` = `entity.symbols.length` (already available, no new extraction).

**Scope:**
1. **Schema** (`src/scanner/semanticEntity.ts`): add `apiCount: number` to `SemanticEntity.metrics` (alongside `size`/`complexity`/etc, `semanticEntity.ts:30-36`), computed as `module.symbols.length` at the point `size: module.files.length` is already set (`semanticEntity.ts:109`). Update `docs/design.md`'s Data Model Sketch (line ~876+) to add this field — per CLAUDE.md, the canonical schema lives there; don't fork it by documenting only in code comments.
2. **Interface** (`src/skin/interface.ts`): change `PlateSpec.shape`/`UnanalyzedSpec.shape` from `"rect" | "diamond"` to a union that also carries a numeric polygon, e.g. add a separate optional `sides?: number` field (keep `shape` as-is for flowchart's rect/diamond use, since that's a distinct, correct convention — don't conflate the two). `sides`, when present, means "render an N-gon with this many sides"; absent means "use the skin's default plate shape" (today's 6-point rounded shape), preserving flowchart/review-view callers that never set it.
3. **Renderer** (`src/skin/renderModulesView.ts:106-113`, and `renderReviewView.ts`'s equivalent block): pass `sides: computeSides(entity.metrics.apiCount)` into `skin.plate(...)`. Put the clamp/log formula in one shared helper (e.g. `src/skin/plateSides.ts`) imported by both renderers — not duplicated.
4. **Skin implementations** (`src/skin/skeletal.ts:57-88`, `src/skin/technicalAtlas.ts:56-89`): add a regular-N-gon point generator (center `(x+width/2, y+height/2)`, radius fit to `width`/`height`, points at `angle = -90deg + i*360/sides` degrees) used when `spec.sides` is present, falling through to the existing rect/diamond branch otherwise. Same change needed in both skins' `plate()` and `unanalyzed()` — factor the N-gon point math into one shared helper (e.g. add to `src/skin/plateSides.ts` alongside the count formula) that both skin files import, rather than copy-pasting the trig into each.
5. **Legend** (only if Branch 1 already merged): add a row noting "sides = API/function surface size" — otherwise leave for a follow-up after Branch 1 lands, to avoid the branches stepping on the same file.

**Files touched:** `src/scanner/semanticEntity.ts`, `src/skin/interface.ts`, `src/skin/renderModulesView.ts`, `src/skin/renderReviewView.ts`, `src/skin/skeletal.ts`, `src/skin/technicalAtlas.ts`, new `src/skin/plateSides.ts`, `docs/design.md`.

**Tests (TDD):**
- `semanticEntity.test` (wherever existing tests for `toSemanticEntities` live): a module with N symbols produces `metrics.apiCount === N`.
- `plateSides.test` (new): formula unit tests at boundary values (0, 1, 2, 7, 8, 100 symbols) confirming clamp behavior.
- `skeletal.test`/`technicalAtlas.test`: `plate({..., sides: 5})` produces a 5-point `<polygon>`; `plate({...})` with no `sides` keeps today's default shape (regression guard for flowchart/other callers that never pass `sides`).
- `renderModulesView.test`: an entity with a given `apiCount` produces a plate call with the expected `sides`.

**Verification:** `npm test`, `npm run lint`, then `npm run dev`, open Modules View, and visually confirm plates for modules with differing symbol counts render as visibly different N-gons (a small utility module as a triangle/quad, a large one as a hexagon/octagon) — compare against a repo fixture with modules of known differing symbol counts.

---

## Sequencing

Independent branches, no ordering dependency — `shellPage.ts` (Branch 1) and the scanner/skin files (Branch 2) don't overlap except optionally the legend row in Branch 2 step 5, which is explicitly deferred if Branch 1 hasn't merged yet. Recommend merging Branch 1 first since it's smaller and self-contained.

Both follow the standard flow: branch → implement (TDD red-green-refactor) → `npm test`/`npm run lint` → review pass (staff-engineer style per `project-review` skill) → push to `origin` → PR → merge via `gh pr merge --merge` (no squash/rebase, preserve merge commit).

# CodeDream Design System Inventory

Read-only inventory of the CodeDream design system, cross-referenced against the analyzer UI/schema inventory (`docs/ui-schema-inventory.md`), done ahead of a UI rebuild. No code was changed as part of this inventory.

**Refresh pass:** this update reflects design-system commit `796a91f` ("updated design system"). Since the original inventory was written, commit `49f6021` ("Pull latest CodeDream design system") added three components — `BubbleChart`, `RiskRadar`, `EdgeDeltaList`/`DeltaRow` — that close every gap flagged in section 6 below. `796a91f` itself only touched `Icon` (ligature-name fixes, three new glyph aliases) and lint config; no new components, no token changes.

**Source:** `/Users/girishpc/projects/claude_projects/code-viz-design-system` (external claude.ai Design export, not part of the semantic_viz repo). React + CSS custom properties, 302 tokens, 37 components, 19 guideline specimens, 2 full UI kits (app + marketing site).

## 1. Source location

- Entry: `styles.css` (imports all token layers under `tokens/`)
- Components: `components/{core,display,layout,code,viz}/*.jsx` + `.d.ts` + `.prompt.md` per component
- Machine manifest: `_ds_manifest.json`; compiled bundle: `_ds_bundle.js`
- Guidelines: `guidelines/*.html` (19 specimen cards); UI kits: `ui_kits/{app,site}/`

## 2. Components (37)

**Core controls (8):** Button, Icon, IconButton, Input, Select, Checkbox, Switch, SegmentedControl
**Display/metadata (6):** Badge, Tag, Card, StatBlock, Tooltip, Dialog
**Layout (4):** Rail, Toolbar, Tray, StatusBar
**Code/diff (5):** DiffHunk, FileRow, CommitTimeline, PathBreadcrumb, EdgeDeltaList (exports `DeltaRow`)
**Canvas/viz (12 + 2 helper modules):** GraphCanvas, PolyNode, Facet, Solid3D, ConnectorLayer, GroupFrame, HeatLegend, RiskMeter, Sparkline, BubbleChart, RiskRadar; `temp.js`, `focus.js` helpers

## 3. Design tokens (302 total)

- **Color:** 16 cool-base surfaces, 7 accent families × 5 steps (cyan/mint/azure/indigo/teal/blue/green), **8-stop temperature scale** (`--temp-0..7`: dormant→stable→active→warm→changed→hot→risk→critical), 10 diff-semantic colors (add/del/mod/move/rename), 5 status colors (pass/run/wait/warn/fail), semantic surface/border/text aliases, graph-object roles (node fill/edge/connector), group/focus colors
- **Typography:** Space Grotesk (core/display) + JetBrains Mono (code/metrics), 12 sizes (11–84px), 6 weights, 4 line-heights, 5 tracking values, 8 composite type roles
- **Spacing:** 15-step base scale (2–128px) + 12 layout metrics (rail 56px, tray 288px, inspector 340px, bar 44px, row 28px)
- **Shape:** 8 radii, 3 border widths, 7 clip-path polygon shapes (chamfer/hex/hex-tall/triangle/diamond/tag), connector geometry
- **Elevation:** 6 shadows, 4 glows (cool/flow/warm/risk — tied to temperature), 2 insets, focus ring, scrim gradients
- **Motion:** 6 durations (90–900ms), 5 easings, 6 keyframe animations, reduced-motion override
- **3D:** light rig, 4 face gradients, 4 extrusion depths, isometric camera tokens
- **Icon:** `ICON_MAP` gained `plus`, `minus`, `gauge` glyph aliases (used by `DeltaRow`'s added/removed/reweighted markers); a handful of existing aliases were repointed to more precise Material Symbols ligatures (e.g. `git-compare`→`compare_arrows`). No token-file changes.

## 4. Guidelines / UI kits

19 HTML specimens covering every token category. Two working UI kits:
- **App kit** (`ui_kits/app/`): `GraphScreen.jsx` (dependency canvas + inspector + legend), `ReviewScreen.jsx` (PR review: changed-file tray + diff hunks + blast-radius mini-canvas + risk meter), `EvolutionScreen.jsx` (commit scrubber + heat snapshot). These are near-literal templates for this project's Current/Delta/Flows views.
- **Site kit**: marketing page, not relevant to analyzer rebuild.

Real usage patterns from these kits: `PolyNode` wired to a shared `focus` state object; `ConnectorLayer` edges keyed by `kind: "import"|"call"|"flow"|"risk"`; `Tray` stacking pattern (never tabs).

## 5. Cross-reference against analyzer UI needs

| Analyzer need (from prior inventory) | Schema source | CodeDream component | Fit |
|---|---|---|---|
| Structural tile canvas (CanvasHost) | `Unit[]`, `Edge[]` | `GraphCanvas` + `PolyNode` (shape by kind) + `ConnectorLayer` | **Strong** — `PolyNode.shape` maps to `Unit.kind` (hex=module/package, chamfer=file, diamond=symbol); `temp` prop maps directly to a risk/change score |
| Delta tile coloring (status/amount/risk ring) | `UnitDelta.status`, `.amount`, `.risk` | `PolyNode` (`temp`, `selected`, `dim`) + `HeatLegend` + `RiskMeter` | **Strong** — temperature scale is essentially `UnitDelta.risk`/`amount` pre-designed |
| Dependency bubbles by depth (DependsOn) | `External[]` (`depth`, `transitive_count`) | `BubbleChart` | **Strong** — grouped/packed circle layout, one band per depth, size encodes `transitive_count`, fill encodes temperature |
| Flowchart (function internals, control_flow edges) | `Unit` (block), `Edge.flowType` | `GraphCanvas` + `PolyNode` + `ConnectorLayer` (`kind:"control"` = travelling dots) | **Strong** |
| Inspector detail panel | `Unit.signature/semantics/cost/metrics/tags` | `Tray` (dock="right", floating) + `StatBlock` (per metric) + `Badge` (tags) + `RiskMeter` | **Strong** |
| InspectQueue (ranked delta list) | `Delta.inspect_queue` | `Tray` + `FileRow`-style rows (temp diamond + added/removed) or custom list with `Badge`/`StatBlock` | **Strong** — `FileRow` was built for exactly this (churn + temperature + selection) |
| Breadcrumb | `Unit.name` path | `PathBreadcrumb` | **Exact match** |
| Replay (commit/PR timeline) | `Rev` (sha, ts, author, message) | `CommitTimeline` | **Exact match** — bar height=churn, color=temp, built for this |
| Legend (layer/group colors) | `Unit.group` | `GroupFrame` + `HeatLegend` | **Strong** |
| Diff/PR review (not yet in analyzer UI — schema gap) | `EdgeDelta`, `UnitDelta.fields` | `DiffHunk` | **New capability enabled** |
| Edge deltas as a distinct list (schema gap) | `EdgeDelta[]` (added/removed/reweighted) | `EdgeDeltaList` / `DeltaRow` | **Exact match** — from→to rows with kind icon and weight-delta display, built specifically for this |
| Multi-axis risk breakdown (schema gap) | `UnitDelta.risk` → `RiskAxes` | `RiskRadar` | **Exact match** — 5(+)-axis radar on the shared 0–7 temp scale, built as the multi-dimensional counterpart to `RiskMeter` |
| Provenance/confidence surfacing (schema gap) | `.source`, `.confidence`, `Unit.provenance` | `Badge` (tone+icon), `Tooltip` | Closable gap — `Badge` can render "llm · 0.82" style confidence tags |
| Blast radius (schema gap) | `UnitDelta.blast_radius` | `RiskMeter` (reasons list) + mini `GraphCanvas` | Closable gap — `ReviewScreen.jsx` kit literally has a "blast-radius mini-canvas" pattern |
| External license/advisories (schema gap) | `External.license/.advisories` | `Badge` (tone="risk") in a `Tray` list | Closable gap |
| Snapshot metadata / "about" view (schema gap) | `Snapshot.provenance` | `Dialog` + `StatBlock` grid | Closable gap |
| Mode/view switcher (App.tsx mode state) | — (UI-only) | `SegmentedControl` or `Rail` | **Exact match** — `Rail` is literally "vertical icon rail for top-level tool navigation" |
| Config/search inputs | — | `Input` (mono variant for paths/SHAs), `Select` | Ready if needed |

## 6. Gaps closed

The three gaps flagged in the original inventory pass are resolved as of design-system commit `49f6021`:

1. **Dependency bubble chart** — closed by `BubbleChart` (`components/viz/BubbleChart.jsx`): grouped/packed circle layout, one band per category, size encodes count, fill encodes temperature. Purpose-built for exactly the `DependsOn.tsx` depth-row use case.
2. **Multi-axis risk breakdown** — closed by `RiskRadar` (`components/viz/RiskRadar.jsx`): 5(+)-axis radar chart on the shared 0–7 temperature scale, explicitly documented as "the multi-dimensional counterpart to RiskMeter's single-axis segments."
3. **Edge-delta-specific view** — closed by `EdgeDeltaList` / `DeltaRow` (`components/code/EdgeDeltaList.jsx`): from→to rows with an added/removed/reweighted kind icon and optional weight-delta display.

No gaps remain in this category. See section 5's cross-reference table for full mapping.

## 7. Rebuild readiness verdict

**Ready.** Every screen in `docs/ui-schema-inventory.md`'s UI inventory (section 1) and every schema gap it flags (section 4, 8 items) now maps to a CodeDream component:

- Gaps 1–5 (provenance, per-unit authorship, risk detail, blast radius, edge deltas) — each has a direct component (`Badge`+`Tooltip`, `RiskRadar`, `RiskMeter`, `EdgeDeltaList`).
- Gaps 6–7 (rollup aggregates, external reverse lookup) — composable from `StatBlock`/`Badge`+`Tray`, no dedicated component needed, same as before this refresh.
- Gap 8 (snapshot metadata/"about" view) — composable from `Dialog` + `StatBlock` grid; unchanged from the original inventory, noted here as a composition rather than a dedicated component, consistent with gaps 6–7.

No "no matching component" gaps remain. The design system (temperature scale, `FileRow`/`CommitTimeline`/`PathBreadcrumb`/`BubbleChart`/`RiskRadar`/`EdgeDeltaList`) was evidently built for this exact tool. The UI rebuild can proceed using CodeDream components as the implementation basis for all Current/Delta/Flows/Review views.

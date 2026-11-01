# UI rebuild: migrate packages/ui to CodeDream design system

## Context

Two prior inventory passes (`docs/design-system-inventory.md`, `docs/ui-schema-inventory.md`, merged to main) established that CodeDream (37 components, 302 tokens, sibling repo `code-viz-design-system`) has full component coverage for every screen in `packages/ui`, with no remaining "no matching component" gaps. This plan sequences the actual rebuild.

`packages/ui` today: React 18 + TS + Vite SPA, Zustand store, **no component library** — every button/panel/card is a hand-styled `<div>`/`<button>` against `app.css` (913 lines, 26 custom properties). 10 screens wired into `App.tsx`, one test file per screen in `packages/ui/test/`.

Verified during planning: CodeDream's `GraphCanvas` (`components/viz/GraphCanvas.jsx`) is a **passive surface only** — grid + vignette + `children`/`overlay` props, no layout engine. This means the existing `@scv/layout` `buildScene()` call, zoom/pan math, and scene-seeding logic in `CanvasHost.tsx` are NOT replaced — they keep producing a scene that gets rendered as `PolyNode`/`ConnectorLayer` children inside `GraphCanvas`. Confirmed root `package.json` workspaces are `packages/*` + `packages/skins/*`, consistent with adding `packages/design-system` as a new workspace package.

### Decisions (user-confirmed)
1. **Tokens**: full switch — drop `app.css`, adopt CodeDream's 302 tokens as the only system; port `--dep`/`--usr` and other app-specific colors into CodeDream's temperature/accent vocabulary.
2. **Layer colors**: rebuild the categorical layer palette from CodeDream's 7 accent families (cyan/mint/azure/indigo/teal/blue/green) instead of reusing `hashLayerToColor()` from `@scv/skin-tiles` as-is — same hashing strategy, new color set.
3. **Flows.tsx**: `Rail` (entry-point list) + custom step rows (`Badge`/`Icon`/`Card`) for the path pane. Confirmed Flows itself is 2 panes; `Inspector` is a separate persistent 3rd pane that `App.tsx` already docks right across every mode — unchanged by this decision.
4. **Skin**: wire up both dark (default) and light (`[data-skin="light"]`) from the start, not deferred.

## Integration: `packages/design-system`

New workspace package, not an npm dependency:
1. `packages/design-system/` — copy CodeDream's `components/`, `tokens/`, `ui_kits/` in
2. `packages/design-system/package.json` — `name: "@scv/design-system"`, `private: true`, React 18 peer dep
3. `packages/design-system/index.ts` — barrel export of all 37 components + token CSS entry path
4. Add `@scv/design-system` to `packages/ui/package.json` deps
5. Import CodeDream's token stylesheet in `packages/ui/src/main.tsx`; delete `app.css` once all screens migrate (not before — keep it during the transition so unmigrated screens don't break)

## Migration sequence

Order: exact-match/low-logic screens first (validates the integration pattern cheaply), then logic-heavy screens, CanvasHost last (largest, most interaction logic).

**Phase 1 — exact matches**
- `Breadcrumb.tsx` → `PathBreadcrumb`. Logic preserved: `goTo(index)` dispatch via focusStack.
- `Legend.tsx` → `GroupFrame` + `HeatLegend`. Layer coloring rebuilt per decision 2 (new palette from CodeDream accents, same hash function shape).
- `Replay.tsx` → `CommitTimeline`. Preserve: PR-scoping, density toggle (PR vs commit), chronological sort, author_kind → author prop.

**Phase 2 — logic-heavy display screens**
- `Inspector.tsx` → `Tray` (dock="right") + `StatBlock` + `Badge` + `RiskMeter` (+ `RiskRadar` for `RiskAxes` breakdown — new capability). Preserve: `LOW_CONFIDENCE` (0.6) warning threshold, unit-vs-external toggle.
- `InspectQueue.tsx` → `Tray` + `FileRow`-style rows. Preserve: ranking order, same `LOW_CONFIDENCE` threshold/styling.
- `DependsOn.tsx` → `BubbleChart`. Map `transitive_count` → `count` prop, `depth` → group name. BubbleChart's own packing algorithm replaces the `sqrt(transitive_count)*8+22` radius formula — test proportionality, not exact px.
- `Flowchart.tsx` → `GraphCanvas` + `PolyNode` + `ConnectorLayer` (kind="control"). Preserve: block-children + control_flow-edge filtering; display-only, no interaction.
- `Flows.tsx` → `Rail` (entry list) + custom step rows using `Badge`/`Icon`/`Card`. Preserve: `entryKind()` grouping, `edgeKind()` lookup, step filtering.

**Phase 3 — CanvasHost** (`packages/ui/src/CanvasHost.tsx`)
→ `GraphCanvas` (surface) + `PolyNode` (tiles) + `ConnectorLayer` (edges), optionally `HeatLegend` overlay in delta mode.
Must port verbatim (CodeDream provides none of this):
- Zoom/pan: wheel 1.1x factor, 0.1–8x bounds, cursor-anchored zoom; drag-pan with 3px hysteresis
- Scene layout seeded from prior frame (`priorSceneRef`) for replay continuity; `buildScene()` still called from `@scv/layout`, output rendered as `PolyNode`/`ConnectorLayer` children
- Double-click branching: drill vs ascend vs `showFlowchart` for function tiles
- Hover: today toggles CSS classes on existing SVG elements without rebuilding, to preserve the pulse animation — with `PolyNode` this must become hover state → `dim`/`selected` props; verify the pulse animation survives a prop-driven re-render (flagged risk, needs early spike/prototype before committing to the full CanvasHost refactor)
- Delta tile coloring (status/amount/risk) → `PolyNode`'s `temp`/`selected`/`dim` props
- Memoized `visibleUnits`/`visibleEdges`/`deltaByUnit` in `App.tsx` (prevents prop churn that would re-trigger the pulse animation on every selection) — keep this memoization, re-verify it still prevents churn against the new component tree

Also touches `App.tsx`: mode/view switcher → `SegmentedControl` or `Rail`; rev picker `<select>` → CodeDream `Select`.

## Test strategy (TDD RED-GREEN-refactor per CLAUDE.md)

Most existing tests assert behavior (grouping, filtering, sort order, thresholds, memoization) and should stay green through the swap — only tests that query DOM by class name or count SVG elements need rewriting to instead assert on props passed to CodeDream components. Per screen: refactor component → run `npm test` → fix assertions that broke on DOM structure (not behavior) → all green → commit. Do not write new implementation before a failing test for any *new* behavior (e.g., `RiskRadar` wiring, dual-skin toggle).

Known test rewrites needed: `CanvasHost.test.tsx` (tile/hover class assertions), `DependsOn.test.tsx` (circle radius formula → proportionality check), `Inspector.test.tsx`/`InspectQueue.test.tsx` (`.low-confidence` class → prop assertion), `Legend.test.tsx` (swatch color class → new palette lookup), `Replay.test.tsx` (`.replay-bar` selector → `CommitTimeline` props).

New tests: dual-skin toggle (`[data-skin]` attribute switch), `RiskRadar` integration in Inspector, rebuilt layer-color palette function.

## Git workflow (per CLAUDE.md)

One `feature/codedream-<phase>` branch per phase (integration setup, phase 1, phase 2, phase 3) rather than one giant branch — each is independently reviewable and mergeable:
- `feature/codedream-integration` — `packages/design-system` setup only
- `feature/codedream-phase1` — Breadcrumb, Legend, Replay
- `feature/codedream-phase2` — Inspector, InspectQueue, DependsOn, Flowchart, Flows
- `feature/codedream-phase3` — CanvasHost + App.tsx mode switcher, app.css removal

Each: implement → `npm test` && `npm run lint` → `project-review` skill → push → PR → merge, before starting the next phase.

## Verification

- After each phase: `npm test` and `npm run lint` clean (per CLAUDE.md required commands)
- After Phase 3: `npm run build` clean; found `app.css` still holds live layout/component CSS for App/Inspector/InspectQueue/DependsOn/Flowchart/Flows with no design-system equivalent wired up yet — full deletion deferred to Phase 4
- Before CanvasHost work starts: small spike verifying the hover/pulse-animation behavior survives the `PolyNode` prop-driven model — this is the one open technical risk flagged above; if it doesn't work as expected, resolve before writing the full CanvasHost refactor

**Phase 4 — retire app.css** (`feature/codedream-phase4`)

Remaining consumers of `app.css`, found by grep after Phase 3: `App.tsx` (`.app`/`.topbar`/`.body`/`.rail`/`.sec`), `Inspector.tsx`/`InspectQueue.tsx` (`.inspector`/`.inspect-queue`/`.meta`/`.tags`/`.low-confidence`/`.semantics`), `DependsOn.tsx` (`.depends-on*`/`.dep-*`), `Flowchart.tsx` (`.flowchart*`), `Flows.tsx` (`.flows*`/`.flow-step*`/`.flow-edge`), `Replay.tsx` (`.replay*`).

Mapping (design-system components confirmed present in `packages/design-system/components/`):
- `.topbar` → `Toolbar` (left/center/right clusters — Breadcrumb | SegmentedControl | Select)
- `.rail`, `.inspector`, `.inspect-queue`, `.flows-rail` (sidebar panels) → `Tray` (collapsible, `dock="left"|"right"`, `title`/`meta`/`actions`/`children`) — **not** `Rail` (that component is a top-level icon-nav rail, not a content sidebar; confirmed via its `.d.ts`, wrong fit)
- Inspector's meta/tags/semantics blocks → `Card` (sections), `Badge`/`Tag` (tags, status, low-confidence marker)
- `InspectQueue` entries → `Card` or `Badge`-based row, same low-confidence treatment
- `DependsOn` rows/circles → keep bespoke SVG (`dep-ext`/circle sizing is a data visualization, not a component-library concern) but restyle via tokens instead of `app.css` custom properties
- `Flows` entry list → `Card`/`Badge` rows (steps), `Tag` for group labels
- `Replay` timeline → `CommitTimeline` (`components/code/CommitTimeline.jsx`: bar height = churn, color = temp, `value`/`onChange` — matches `.replay-track`/`.replay-rev`/`.replay-bar` almost directly)
- Remaining `:root` custom properties (`--dep`/`--usr`/etc., already partially ported in Phase 1 decision #1) → finish porting any still read from `app.css` onto design-system tokens

Sequencing: one component at a time, same TDD/test-rewrite discipline as Phases 1–3 (tests asserting on `app.css` class names become prop/structure assertions against the new components), all on one `feature/codedream-phase4` branch, single PR at the end — per user decision, not split further.

After Phase 4: `npm run build` clean, `app.css` deleted for real, manual smoke test via dev server across all 5 modes (current/delta/depends/flows/flowchart) and both skins (dark/light), README.md updated (status table + a screenshots section).

## Next step: mock UI (before Phase 1)

Before scaffolding `packages/design-system`, build a static HTML mock of 2-3 representative screens (CanvasHost + Inspector, optionally DependsOn) using CodeDream's actual components/tokens and fixture-shaped data. Goal: visually validate the riskiest mapping bets — `PolyNode.shape` per `Unit.kind`, temperature-scale coloring for delta/risk, `BubbleChart` for dependency depth — before committing to package scaffolding or the CanvasHost port. Saved to `docs/mock/` in this repo (static reference, not part of the `packages/design-system` workspace) and published as an Artifact for quick visual review.

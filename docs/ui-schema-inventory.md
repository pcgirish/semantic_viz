# Analyzer UI ↔ Schema Inventory

Read-only inventory of `packages/ui` cross-referenced against `packages/schema`, done ahead of a UI rebuild. No code was changed as part of this inventory.

## 1. UI Inventory — `packages/ui`

React 18 + TypeScript + Vite SPA, Zustand for state. 10 screen/major components, all imported from `App.tsx`, no dead code found.

| Screen / Component | Path | Purpose | Schema types consumed | UI patterns | Status |
|---|---|---|---|---|---|
| **App** | `src/App.tsx` | Root orchestrator: loads snapshot/delta, mode switch, layout | `Snapshot`, `Delta` | Conditional view composition | Active |
| **CanvasHost** | `src/CanvasHost.tsx` | Structural tile map, Current/Delta modes | `Unit[]`, `Edge[]` | SVG canvas, zoom/pan, hover-highlight, tile fill/ring for delta status | Active |
| **Flows** | `src/Flows.tsx` | API entry-point traces, grouped by method | `Unit` (kind `api_flow`, `.route`, `.steps`), `Edge[]` | Two-pane list (rail + path), step badges | Active |
| **DependsOn** | `src/DependsOn.tsx` | External dependency supply chain, by depth | `External[]` (`depth`, `transitive_count`) | Bubble chart, rows by depth, size-encodes count | Active |
| **Flowchart** | `src/Flowchart.tsx` | Function internals (control-flow blocks) | `Unit` (kind `function`/`block`), `Edge` (kind `control_flow`, `.flowType`) | Block diagram, read-only detail view | Active |
| **Inspector** | `src/Inspector.tsx` | Right-panel detail for selected unit/external | `Unit` (`.signature`, `.semantics`, `.cost`, `.metrics`, `.tags`), `External` | Form-like field list, in/out params, edge lists | Active |
| **InspectQueue** | `src/InspectQueue.tsx` | Delta-mode ranked change list | `Delta.inspect_queue` (`InspectQueueEntry`) | Sorted table/list, confidence flag on low values | Active |
| **Breadcrumb** | `src/Breadcrumb.tsx` | Focus-path navigation | `Unit.name`/`.id` for lookup only | Breadcrumb trail | Active |
| **Replay** | `src/Replay.tsx` | Revision timeline scrubber | `Rev` fields (`sha`, `ts`, `author`, `author_kind`, `message`) via `/api/revs` | Bar timeline, PR vs commit density toggle | Active |
| **Legend** | `src/Legend.tsx` | Layer/group color key | `Unit` (kind `layer`, `.group`) | Grouped color-swatch list | Active |

No dead/unused screens — every component is wired into `App.tsx`.

## 2. Schema Inventory — `packages/schema`

Zod-based (`src/index.ts`). Top-level exported types:

- **Unit** — id, kind (enum: system/layer/module/package/class/function/api_flow/block/config), name, qualname, lang, parent, children, loc (`Loc`), signature (`Signature`→`Port[]`), semantics (`Semantics`), cost (`Cost`), tags, metrics, authors (`Author[]`), hash (`Hash`), provenance (`UnitProvenance`), route, steps, group
- **Edge** — id, from, to, kind (enum: calls/imports/inherits/implements/reads/writes/emits/handles/configures/tests/control_flow), weight, evidence (`Evidence[]`), source, confidence, rollup, flowType
- **External** — id, ecosystem, name, version, direct, depth, reached_by, transitive_count, license, advisories, source
- **Snapshot** — schema, snapshot_id, repo, rev (`Rev`), provenance (`SnapshotProvenance`), units[], edges[], externals[]
- **Delta** — schema, from/to (`SnapshotRef`), provenance (`DeltaProvenance`), inspect_queue (`InspectQueueEntry[]`), unit_deltas (`UnitDelta[]`), edge_deltas (`EdgeDelta[]`), rollup (`Record<string, RollupEntry>`)
- **UnitDelta** — unit, qualname, kind, status, fields, amount, blast_radius (`BlastRadius`), authors, risk (`Risk`→`RiskAxes`)
- **EdgeDelta** — edge, from, to, kind, status

Metadata fields: `confidence` (Semantics, Cost, Edge, Risk, InspectQueueEntry), `source`/`provenance` (static|llm, on Port/Semantics/Cost/Edge/External/Unit), `loc`/`evidence` (files, line, sloc), `hash` (struct/text/semantic), `rev` (sha, ts, author).

## 3. Cross-Reference

| Schema type/field | Rendered in | Not rendered anywhere |
|---|---|---|
| `Unit` core (id, kind, name, qualname, parent, children) | CanvasHost, Inspector, Breadcrumb, Legend, Flows | — |
| `Unit.loc` (files, start, end, sloc) | Inspector (sloc only) | `files`, `start`, `end` not shown |
| `Unit.signature` / `Port[]` | Inspector | `Port.source` (static/llm) not shown |
| `Unit.semantics` (what/how/when/where/why + confidence) | Inspector | — |
| `Unit.cost` (complexity, io, estimate, confidence) | Inspector (metrics section) | `Cost.source` not shown |
| `Unit.tags` | Inspector | — |
| `Unit.metrics` (Record<string,number>) | Inspector | — |
| `Unit.authors` / `Author.lines` | — | **Not rendered anywhere** (Replay shows commit author, not per-unit `Unit.authors`) |
| `Unit.hash` (struct/text/semantic) | — | **Gap** |
| `Unit.provenance` (source, pass A–D) | — | **Gap** |
| `Unit.route`, `Unit.steps` (api_flow) | Flows | — |
| `Unit.group` (layer) | Legend | — |
| `Edge` core (from, to, kind, weight) | CanvasHost (hover), Inspector (depends-on/used-by) | — |
| `Edge.evidence` (file, line) | — | **Gap** |
| `Edge.source`, `Edge.confidence` | — | **Gap** |
| `Edge.rollup` | — | **Gap** |
| `Edge.flowType` (control_flow branch type) | Flowchart | — |
| `External` core (id, ecosystem, name, version, depth, transitive_count) | DependsOn | — |
| `External.direct` | DependsOn (implicit via depth=1 row) | not explicitly labeled |
| `External.license`, `External.advisories` | — | **Gap** |
| `External.reached_by` | — | **Gap** (no way to see which units use a given external) |
| `Snapshot.repo`, `Snapshot.provenance` (extractor/interpreter) | — | **Gap** (no "about this snapshot" view) |
| `Rev` (sha, ts, author, author_kind, message) | Replay | — |
| `UnitDelta` (status, fields, amount, authors) | InspectQueue (partial: status, risk, confidence) | `fields` (which fields changed), `amount`, `authors` not shown |
| `UnitDelta.blast_radius` (direct, transitive, public_api) | — | **Gap** |
| `UnitDelta.risk` / `RiskAxes` (5-axis breakdown) | InspectQueue (score only) | `RiskAxes` breakdown, `why`, `rank`, `ground_truth`, `formula_floor` not shown |
| `EdgeDelta` (added/removed/reweighted edges) | — | **Gap** (CanvasHost shows tile deltas, not edge deltas explicitly) |
| `Delta.rollup` (aggregated impact by category) | — | **Gap** |
| `InspectQueueEntry` (rank, confidence) | InspectQueue | `ground_truth` not shown |

## 4. Gaps — schema with no UI (rebuild must cover)

1. **Provenance/trust surfacing** — `Unit.hash`, `Unit.provenance` (pass A/B/C/D), `Edge.source`/`confidence`/`evidence` are never shown. No way to see *how* a fact was derived (static analysis vs LLM) or verify it against source.
2. **Per-unit authorship** — `Unit.authors` (who wrote this, line counts) unused; only commit-level author shown in Replay.
3. **Risk detail** — `RiskAxes` (functionality/availability/scalability/performance/security breakdown), `risk.why`, `ground_truth`, `formula_floor` computed but not surfaced — InspectQueue shows only a single risk number.
4. **Blast radius** — `UnitDelta.blast_radius` (direct/transitive dependents, public_api flag) computed but invisible.
5. **Edge deltas** — `EdgeDelta[]` (added/removed/reweighted relationships) has no dedicated view.
6. **Rollup aggregates** — `Delta.rollup` (category-level impact summary) unused.
7. **External dependency reverse lookup** — `External.reached_by`, `.license`, `.advisories` not shown; can't audit which units pull in a risky/unlicensed package.
8. **Snapshot metadata** — no "about" view for `Snapshot.repo`, `.provenance.extractor/interpreter` (which tool/model produced this analysis).

## 5. UI with no clear schema backing

None found. Every screen maps cleanly to schema types (`CanvasHost`→Unit/Edge, `Flows`→api_flow Units, `DependsOn`→External, `Flowchart`→block Units/control_flow Edges, `InspectQueue`→Delta, `Replay`→Rev, `Legend`→layer Units, `Inspector`→Unit/External, `Breadcrumb`→navigation-only, no dedicated schema type needed). No dead/legacy screens to drop.

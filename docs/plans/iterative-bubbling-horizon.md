# Plan: Codebase Visualizer (project_viz)

## Context

A developer wants to build a 3D visualizer that treats a codebase as a navigable landscape — understanding semantic connections, design intent, and how code evolved commit by commit. A 6-stage multi-agent design pipeline was run (3 proposals, cross-peer review, coordinator decision, auditor revision). The final decision is a hybrid: Opus's scalable core architecture + Haiku's UX zoom hierarchy + Sonnet's hotspot/color system.

**Post-pipeline addition:** All three proposals missed LLM enrichment — the mechanism that makes this a *semantic* visualizer rather than a structural one. LLM-generated summaries, embeddings for semantic clustering, commit narration, and flow descriptions are now first-class pipeline stages.

**No backend server required:** The analyze script runs once (or in watch mode) and writes SQLite. The frontend reads SQLite directly via Electron IPC or WASM SQLite. No HTTP server needed for v1.

This plan covers the full v1 implementation from a greenfield repo (zero application code; only Claude Code harness exists).

---

## Chosen Architecture

**Metaphor:** Codebase as a navigable 3D landscape. Modules are regions; classes are buildings; functions are rooms. Git history is a time slider, not a spatial axis. Color encodes domain (hue), recency (saturation), activity (brightness).

**Key insight:** The zoom hierarchy (Continent→City→Building→Room) *drives* LOD selection in a geometric octree. Semantic navigation and spatial efficiency are orthogonal and compose cleanly.

**Understanding vs. presentation — the skin architecture:** The semantic model (entities, relations, LLM annotations, metrics, time series) is strictly visualization-agnostic; nothing in the analyze pipeline knows how it will be drawn. A **skin** is a pluggable mapping from that model to layout + geometry + color + LOD rules, behind a common `Skin` interface. Shared chrome — timeline, search, selection, hover/flow/flowchart panels — is skin-independent and works identically under every skin. v1 ships two skins:

1. **Landscape** (default) — the city/terrain metaphor described in this plan.
2. **Age Strata** — geological cross-section: elevation/color encode code age (old bedrock at the bottom, recent topsoil on top); churn shows as erosion. Uses only data already in the model.

A third skin (e.g., change-coupling galaxy) is a v2 candidate; the interface must make adding one a matter of implementing layout+geometry mappings, never touching the model or chrome.

### Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend | React 18 + Three.js + React Three Fiber + Zustand + Vite + TypeScript |
| Parsing | TypeScript compiler API for JS/TS (gives *resolved* call/import edges, not just syntax); web-tree-sitter (WASM — avoids native-module rebuild pain in Electron) for later languages, with uncertainty flags |
| LLM enrichment | **Multi-provider** behind a role-based adapter: Anthropic (default: claude-haiku-4-5 bulk / claude-sonnet-5 rich), OpenAI, and Ollama (local models — enables fully-offline enrichment). **No embeddings in v1.** |
| Storage | SQLite (entity/relation graph + commit snapshots + LLM enrichments) |
| Rendering | Single unified WebGL context; four "views" = camera+filter states |
| Git ingestion | isomorphic-git or simple `git log` subprocess |
| Deployment | Electron (local-file visualizer); analyze script runs once, writes SQLite |

### Core Data Model

```typescript
interface Entity {
  id: string;           // stable hash across commits (fully-qualified name)
  type: "module" | "class" | "function";
  name: string;
  bbox: BoundingBox3D; // position in octree
  metrics: { loc: number; complexity: number; churn: number; };
  // LLM-enriched fields (populated by Phase 2 enrichment step)
  summary?: string;          // "What this does and why it exists"
  intent?: string;           // one-line purpose label
  domain?: string;           // LLM-inferred domain (auth, payments, ui, etc.)
  flowchart?: FlowchartAnnotation; // functions only; enriched for top-N by centrality/churn
  // No embedding field in v1 — search uses FTS5 over summaries; layout uses LLM
  // module grouping. SQLite schema keeps an optional embedding column for v2.
}

interface FlowchartAnnotation {
  // Structure comes from the parser's control-flow graph (cannot be hallucinated);
  // the LLM only writes plain-English labels onto verified nodes.
  steps: { label: string; lineRange: [number, number] }[];
  branches: { condition: string; fromStep: number; toStep: number }[];
}

interface Relation {
  from: string;         // entity ID
  to: string;
  type: "calls" | "imports" | "extends" | "uses";
  weight: number;
  uncertainty: "certain" | "inferred"; // flag for dynamic language limits
}

interface CommitSnapshot {
  sha: string;
  timestamp: number;
  message: string;
  semanticLabel?: string;    // LLM-generated: "Extracted auth middleware"
  entities: Entity[];
  relations: Relation[];
  delta: { added: string[]; removed: string[]; modified: string[]; };
}

interface UnifiedModel {         // shared Zustand store
  octree: SpatialIndex<Entity>;
  timeSeries: CommitSnapshot[];
  entities: Map<string, Entity>;
  selectedEntities: Set<string>;
  cameraState: { position: Vector3; lookAt: Vector3; fov: number; projection: "ortho" | "perspective"; };
  viewFilter: { showLayers: Set<string>; colorBy: string; highlightDeps: Set<string>; zoomLevel: "continent" | "city" | "building" | "room"; };
  timeState: { currentTime: number; playbackSpeed: number; isPlaying: boolean; };
}
```

### Zoom/LOD Mapping

| Zoom Level | Octree Depth | Visible Entities | Camera |
|------------|--------------|-----------------|--------|
| Continent | 0–1 | Module outlines (AABBs) | Top-down ortho, fit-all |
| City | 1–2 | Modules + Classes | Zoomed to one module |
| Building | 2–3 | Classes + Functions with edges | Zoomed to one class |
| Room | 3 | Functions + Call edges | Full resolution, perspective |
| Blueprint | — (2D panel) | Inside one function: annotated control-flow steps | Synced 2D flowchart panel, not 3D |

### Time Scrubbing

Timeline slider at bottom of screen. **Orthogonal to zoom.** Updating `timeState.currentTime` causes all views to filter entities/relations to those existing at that timestamp. Entities deleted before the selected time fade out; entities added after it are hidden by default (a "show future as ghosts" toggle renders them muted for then-vs-now comparison). Zoom level is unchanged when scrubbing.

**Timeline granularity toggle — commit or PR.** The original brief asked for PR-to-PR evolution, not just commit-to-commit. PR/merge grouping is derived locally from merge commits (first-parent traversal of `git log --merges`); the scrubber can step by commit or by PR-sized change, with `semanticLabel` generated at whichever granularity is active.

---

## Implementation Phases

### Phase 1 — Data Pipeline (Weeks 1–2)
**Goal:** Parse a local git repo into the Entity/Relation/Snapshot model. First failing tests, then implementation.

**Files to create:**
- `src/parsers/ir.ts` — Entity, Relation, CommitSnapshot types
- `src/parsers/typescript.ts` — TS compiler API → IR with *resolved* call/import edges (`uncertainty: "certain"`); syntax-only fallbacks flagged `"inferred"`
- `src/parsers/index.ts` — language dispatcher (file extension → parser)
- `src/parsers/cfg.ts` — control-flow graph extraction per function (feeds Phase 2 flowchart annotation)
- `src/history/git-reader.ts` — walk git log, extract diffs, build snapshots; group merge commits into PR-sized changes (first-parent traversal)
- `src/history/identity.ts` — rename/move detection: git similarity index (`--follow`-style) matches renamed entities to their prior IDs so churn and time-scrub continuity survive refactors
- `src/history/compression.ts` — commit-level v1 (no compression yet; store all)
- `src/storage/schema.ts` — SQLite schema (see below)
- `tests/parsers/`, `tests/history/` — TDD: parse fixture files, assert entity/relation output; rename a function in fixture history, assert identity preserved

**SQLite schema (dedup by design):** entities and relations are interned once with validity ranges (`first_seen_sha`, `last_seen_sha`, content hash per version) — snapshots are stored as **deltas only**, never as full per-commit copies of the graph. `CommitSnapshot` objects are materialized from these at query time. A 1000-commit repo must not store the graph 1000 times.

**Entry point:** `npm run analyze -- /path/to/repo` → writes SQLite DB.

**Design validation:** `project_viz` itself has no source yet — vendor a small real fixture repo (with genuine commit history, including at least one rename) into `tests/fixtures/`; that is the Phase 1 test subject.

### Phase 2 — LLM Enrichment (Weeks 2–3)
**Goal:** After structural parsing, call Claude API to make the graph *semantic*. This is the phase that distinguishes a semantic visualizer from a structural one.

**What gets enriched:**

| Target | Prompt | Output stored on |
|--------|--------|-----------------|
| Each module/class/function | "What does this code do and why does it exist?" | `Entity.summary`, `Entity.intent` |
| Each entity | "What domain does this belong to?" | `Entity.domain` (replaces fragile heuristic Hue) |
| Module list (single call) | "Group these modules by conceptual similarity; give placement adjacency" | module placement groups (drives Landscape layout) |
| Top-N functions (by centrality + churn) | "Label each control-flow step in plain English" (structure supplied from parser CFG) | `Entity.flowchart` |
| Each commit | "Summarize what changed in one phrase" | `CommitSnapshot.semanticLabel` |
| Each call flow (top-N entry points) | "Describe this flow in plain English" | stored in `flows` table |

**LLM strategy — multi-provider by design:**
- The enrichment pipeline talks to an `LLMProvider` interface with two **roles**, never to a vendor SDK directly:
  - `bulk` — high-volume, cheap: entity summaries, domain labels
  - `rich` — quality-sensitive: module grouping, commit narration, flow descriptions, flowchart step labels
- Providers map roles to their own models. v1 adapters: **Anthropic** (default: `claude-haiku-4-5` bulk / `claude-sonnet-5` rich), **OpenAI**, **Ollama** (local; no API key; makes fully-offline enrichment possible on a laptop)
- Selected via config/flag: `--provider anthropic|openai|ollama` (+ optional `--model-bulk`/`--model-rich` overrides); API keys via provider-specific env vars, never stored
- Structured output is a per-adapter concern (Anthropic tool-use, OpenAI `json_schema`, Ollama `format: json`); the pipeline sees one validated JSON shape — adapters own the coercion and retry-on-malformed logic
- Batch requests: process ~20 entities per call using structured output (batch size tunable per provider; local models may need smaller batches)
- Cache all results in SQLite — never re-call for unchanged entities. Cache key = **content hash + provider + model**, so switching providers re-enriches cleanly instead of serving another model's cached output
- Run enrichment **after** full structural parse; structured parse always happens first so LLM has full context (imports, callers, callees) not just the raw source

**Cost controls (mandatory, not optional):**
- **Enrich the HEAD snapshot only** by default. Historical entity versions inherit the summary of their nearest enriched version — per-entity-per-commit enrichment is a multiplicative cost explosion and is never the default. `--enrich-history` opts in.
- **Print a token/cost estimate and prompt for confirmation** before the first API call (entity count × avg tokens; skippable with `--yes`).
- **Resumable:** enrichment progress persists to SQLite per entity; a run killed at entity 1,400/2,000 continues where it stopped on re-run. No lost spend.
- Entry points for flow description are detected as: exported functions with zero internal callers, `main`-style entrypoints, and recognized HTTP handler registrations (Express/Fastify/Next patterns) — plus anything the user clicks later in the UI.

**Layout: semantic at module level only — no embeddings, no force-directed:**
- One Sonnet call groups modules by conceptual similarity → module placement on the continent (readable rationale, deterministic once cached)
- Classes/functions nest *inside* their parent's bounding box via treemap packing — containment is preserved, so the zoom hierarchy stays coherent
- Positions are **anchored across commits**: surviving entities never move between snapshots; new entities are placed inside their parent near siblings. Spatial memory survives time scrubbing.

**Concept search via SQLite FTS5, not embeddings:**
- Full-text index over `summary` + `intent` + `domain`. A query for "authentication" matches every entity whose LLM-written summary mentions auth, sessions, tokens, login — no query-time model needed, works fully offline.

**Files to create:**
- `src/enrichment/llm-provider.ts` — `LLMProvider` interface (roles: `bulk`, `rich`); batching; rate-limit handling; structured-output validation
- `src/enrichment/providers/anthropic.ts` — Anthropic adapter (default)
- `src/enrichment/providers/openai.ts` — OpenAI adapter
- `src/enrichment/providers/ollama.ts` — Ollama adapter (local HTTP endpoint; offline enrichment)
- `src/enrichment/entity-enricher.ts` — per-entity summary + domain + embedding
- `src/enrichment/commit-narrator.ts` — per-commit semantic label
- `src/enrichment/flow-describer.ts` — top-N call flows → plain-English description
- `src/enrichment/flowchart-annotator.ts` — parser CFG + source → LLM step labels for top-N functions
- `src/enrichment/module-arranger.ts` — module summaries → LLM grouping → continent placement
- `src/enrichment/search-index.ts` — FTS5 index over summary/intent/domain
- `src/enrichment/cache.ts` — SQLite cache keyed by content hash; skip already-enriched entities
- `tests/enrichment/` — TDD: cache hits skip LLM calls; batching groups correctly; fallback when API unavailable

**Entry point:** `npm run analyze -- /path/to/repo` runs parse → enrich → layout → write SQLite. Progress bar shows both phases. `--skip-llm` flag runs parse-only for fast iteration.

### Phase 3 — Graph Engine + Layout (Weeks 3–4)
**Goal:** Octree spatial index over entities (positioned by module grouping + nested treemap packing); LOD queries; Electron IPC.

**Files to create:**
- `src/landscape/octree.ts` — SpatialIndex<Entity>: insert, query by AABB, LOD traversal
- `src/landscape/layout.ts` — module-group placement + treemap nesting inside parent bboxes; position anchoring across commits
- `src/landscape/lod.ts` — map zoomLevel → octree depth → visible entity set
- `src/ipc/handler.ts` — Electron IPC handler: query SQLite, return entities/relations/timeline
- `tests/landscape/` — TDD: octree queries, LOD transitions, semantic position stability across commits

### Phase 4 — Frontend Foundation (Weeks 4–6)
**Goal:** Unified WebGL context with camera+filter states. Continent→City→Building→Room navigation working.

**Files to create:**
- `src/ui/App.tsx` — shell layout (viewport + sidebar + timeline)
- `src/ui/Viewport.tsx` — Three.js canvas; reads UnifiedModel store; delegates rendering to the active skin
- `src/ui/store/index.ts` — Zustand UnifiedModel store (adds `activeSkin: string`)
- `src/ui/skins/Skin.ts` — skin interface: `layout(model) → positions`, `geometryFor(entity, lod)`, `colorFor(entity, viewFilter)`, declared LOD support
- `src/ui/skins/landscape/` — default Landscape skin (city/terrain metaphor)
- `src/ui/skins/strata/` — Age Strata skin (elevation/color = code age; churn = erosion); proves the interface by existing
- `src/ui/views/ContinentView.ts` — camera preset + filter for continent zoom
- `src/ui/views/CityView.ts` — city camera + filter
- `src/ui/views/BuildingView.ts` — building camera + filter
- `src/ui/views/RoomView.ts` — room camera + filter
- `src/ui/components/ZoomControls.tsx` — mouse-wheel/pinch zoom; dispatches zoomLevel transitions
- `tests/ui/` — TDD: store updates, camera transitions, filter application

**Rendering strategy:** `InstancedMesh` per entity type is the technique that actually delivers 60fps at 10k+ entities — one draw call per type, per-instance color/transform attributes. The octree/LOD selects *which* instances are visible; instancing is *how* they're drawn cheaply. (Note: since layout is now 2D ground-plane + height, the octree may simplify to a quadtree — decide in Phase 3 when the spatial index is built; the `SpatialIndex` interface stays the same either way.)

**Interaction:** double-click entity → zoom in one level; back button → zoom out. All views synchronized via Zustand.

**v0 milestone (go/no-go checkpoint):** At the end of this phase, a static single-commit landscape must be navigable end-to-end — fly through Continent→Room on a real repo with LLM summaries on hover. This is where the metaphor is validated *before* investing in time scrubbing, flows, and the second skin. If the landscape doesn't communicate at v0, revisit the skin design rather than building more on top of it.

### Phase 5 — Time Scrubbing + Hotspot Detection (Weeks 6–7)
**Goal:** Timeline slider working; entities filter by timestamp; hotspot glow; semantic commit labels appear on scrubber.

**Files to create:**
- `src/ui/components/Timeline.tsx` — horizontal scrubber; shows `CommitSnapshot.semanticLabel` on each commit dot; dispatches timeState.currentTime
- `src/ui/components/Hotspot.tsx` — shader/material for >N churn glow effect
- `src/query/temporal.ts` — filter entities/relations by timestamp
- `src/query/hotspots.ts` — compute churn scores; flag top-N entities
- `tests/query/` — TDD: temporal filtering, hotspot score computation

**Color encoding:** Three.js MeshStandardMaterial HSL-based: Hue = `Entity.domain` (LLM-inferred: auth, payments, ui, etc.), Saturation = recency (0 = oldest, 1 = newest), Brightness = activity (churn score).

**Semantic hover panel:** Hovering any entity shows `Entity.summary` and `Entity.intent` from LLM enrichment — not just the file name.

### Phase 6 — Call Flows + Radial Projection (Weeks 7–8)
**Goal:** User clicks a function or route; DFS traces all reachable call edges; animated beam highlight; LLM-generated plain-English flow description in sidebar.

**Files to create:**
- `src/query/flows.ts` — DFS/BFS from entry point; returns ordered call chain; uncertainty flags included
- `src/ui/components/CallFlow.tsx` — animated glowing line path through 3D scene; radial projection option
- `src/ui/components/FlowPanel.tsx` — sidebar: shows call stack as collapsible tree + `flow.description` from LLM enrichment; sync with 3D highlight
- `src/ui/components/BlueprintPanel.tsx` — 2D flowchart of a selected function: parser CFG geometry + LLM step labels; hover maps steps to source lines; unenriched functions show structural-only chart with a "run analyze to enrich" nudge
- `tests/query/flows.ts` — TDD: DFS correctness, cycle handling, uncertainty propagation

**Search by concept:** The search bar accepts natural-language queries ("find the payment flow", "where is authentication handled") — matched via the FTS5 index over LLM summaries/intents/domains. No query-time model; embedding-based search is a v2 upgrade.

### Phase 7 — Polish + Testing + Docs (Weeks 8–9)
- End-to-end tests on 2 real repos (project_viz + one OSS project)
- Test `--skip-llm` flag produces valid (structural-only) output
- CLI usage guide with screenshots
- Performance profiling: ensure 60fps at Building level for repos up to 10k files; LLM enrichment throughput for 200-file repo
- History compression v2 planning (era buckets for repos with 1000+ commits)

---

## Critical Design Notes

**LLM enrichment is the semantic layer:** tree-sitter gives structure (who imports whom); Claude gives semantics (what it means and why it exists). Both are required. The `--skip-llm` flag must always produce a valid structural visualization, but without summaries, concept search, domain colors, or flow descriptions.

**LLM enrichment runs at analysis time, not interaction time.** All LLM calls happen in the `analyze` script through the provider adapter; results are cached in SQLite by content hash + provider + model. The frontend never calls any LLM API directly. This means zero latency at visualization time and no API key needed in the Electron app at runtime. With the Ollama provider, the entire pipeline — parse, enrich, visualize — runs offline.

**Skeleton + annotation, at every level:** The parser/git extracts deterministic structure (import graph, call graph, control-flow graph, commit history); the LLM only annotates that structure with meaning (summaries, groupings, step labels, narration). The LLM never invents structure — it labels nodes the parser verified. This one pattern replaces embeddings entirely in v1.

**Layout is anchored, precomputed, and containment-preserving:** Module positions come from LLM conceptual grouping; children nest inside parents via treemap packing. Surviving entities never move between commit snapshots. The browser never runs a physics simulation, and time scrubbing never rearranges the map.

**TDD boundary:** Strict RED-GREEN-Refactor applies to the data pipeline, enrichment, layout, query, and store logic — everything that transforms data. The Three.js render layer (skins, materials, cameras, shaders) is exempt: keep it a thin, logic-free shell over the store and verify it visually. Any logic worth testing must live below the skin interface, not in it.

**Static-analysis limitation (accepted risk):** Dynamic calls (Python duck typing, JS runtime dispatch, reflection) are unrecoverable from static analysis. For JS/TS the compiler API resolves most edges as `"certain"`; other languages via tree-sitter carry more `"inferred"` flags. **Uncertainty rendering is specified, not vague:** inferred relations draw as dashed/translucent edges in every skin; hover tooltips say "inferred — not statically verified"; flow traces report the count of uncertain hops in the FlowPanel. LLM summaries may note "called via reflection" but never create edges the analyzer cannot see.

**Unified WebGL context:** All four views share one Three.js renderer. "Views" are camera+filter state combinations in Zustand, not separate canvases. Prototype the camera+filter model in Week 4 before committing to the full frontend.

**Octree LOD vs. semantic zoom:** The zoom hierarchy is a semantic label that drives octree depth. `ContinentView` queries octree at depth 0–1; `RoomView` at depth 3. These do not conflict. The octree is the implementation; the zoom levels are the UX.

---

## Verification

After Phase 1 (structural parse):
- Run `npm run analyze --skip-llm .` on project_viz; inspect SQLite; assert entities parsed for `.ts` files; assert relations have `uncertainty` flags.

After Phase 2 (LLM enrichment):
- Run `npm run analyze .` (with LLM); assert `Entity.summary`, `Entity.domain` populated and `Entity.flowchart` present for top-N functions; assert FTS5 query "authentication" returns relevant entities; assert cache prevents re-calls on second run; assert `CommitSnapshot.semanticLabel` present.

After Phase 3 (graph engine):
- Assert octree built from entity positions; assert LOD queries return correct entity sets per zoom level.

After Phase 4 (frontend):
- Open visualizer on project_viz; navigate Continent → City → Building by double-clicking; hover an entity and see its LLM summary in the panel; confirm LOD transitions fire and camera moves smoothly.

After Phase 5 (time scrubbing):
- Scrub timeline back to first commit; assert only entities present at that time are visible; assert commit dots on timeline show `semanticLabel`; assert hotspot glow fires for entities modified in >3 commits.

After Phase 6 (call flows):
- Click a function node; assert DFS traces outgoing calls; animated beam appears; sidebar shows call stack + LLM flow description; Blueprint panel renders annotated control-flow steps for an enriched function; search bar accepts "find authentication" and highlights matching entities via FTS.
- Switch skins Landscape ↔ Age Strata; assert selection, timeline position, and open panels survive the switch unchanged.

Full end-to-end:
- Point visualizer at a medium OSS repo (~200 files); confirm 60fps at Building level; LLM enrichment completes in <2 minutes for 200 entities; time scrubbing responsive (<100ms per frame); concept search returns semantically relevant results.

---

## Open Decisions (Resolve Before Coding Begins)

1. **Analyze script language:** Node.js + TypeScript — **resolved.** With embeddings/UMAP cut from v1, the Python case evaporates; single ecosystem with the frontend.
2. **Deployment:** Electron (local-only, no server ops) — resolved. Provider API key (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`; none for Ollama) read from env at analysis time only; never needed at runtime, never stored.
3. **History compression style:** Calendar windows (predictable, debuggable) as default; era-bucket label as the user-facing toggle. Resolved.
4. **Embeddings:** **Cut from v1** — module layout via LLM grouping, search via FTS5, deep semantics via CFG + step annotation. SQLite schema keeps an optional embedding column so v2 (synonym-level search, semantic drift) is additive, not a migration.
5. **Flowchart enrichment top-N:** what N (and centrality/churn weighting) for pre-enriched blueprints? Default: N=50 or top decile, whichever is smaller; tune after first real run.

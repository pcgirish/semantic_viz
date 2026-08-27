# Plans

Implementation plans produced during Claude Code plan-mode sessions, migrated here from
`~/.claude/plans/` (a local, non-version-controlled directory where filenames are random
slugs and reused slugs silently overwrite prior content). Kept here so plan history is
diffable and durable.

Files were originally copied over under those random slugs; they have since been renamed
to describe their contents. Implemented plans are kept rather than deleted — they record
*why* a design landed the way it did, which the code alone does not.

**Status legend** — `Implemented`: every phase shipped and merged. `Partial`: some phases
shipped, others explicitly deferred (see the plan's own verification/branching section).
`Superseded`: overtaken by a later plan, kept for history.

## Active / unfinished

| Plan | Status | Summary |
|---|---|---|
| `layout-direction-foundations-at-top.md` | **Approved, not started** | Flip dependency-graph row placement so foundational/high-fan-in modules render at the top instead of the bottom (`place.ts`/`route.ts`), plus a Legend direction cue. Flowchart view (`flowchart.ts`) explicitly out of scope and unaffected. |
| `cityscape-navigation-and-scale.md` | **Partial** | 3D-skin navigation and scale gaps. Phases 1–6 done and browser-verified (fly-drag rotation, compass, focus render order + `depthWrite`, continuous-zoom drill/ascend, sloc height rescale, always-visible legend tray, controls help). **Phase 7 root fix — the Interpreter `MAX_TOP_LAYERS` cap (5–9 top layers, smallest clusters merged into synthetic parent groups) — is not started**, deliberately scoped to its own branch off `main`. Phase 7's UI mitigation (search-to-focus, default-collapse past the 6th layer) did ship. Also raised, out of scope: the `ring`/`heat` risk channel has no producer, so beacons and minimap risk markers are unreachable end to end. |

## Implemented

| Plan | Status | Summary |
|---|---|---|
| `original-architecture-pipeline.md` | Superseded | The original Codebase Visualizer (project_viz) architecture: 3D landscape metaphor, zoom hierarchy, skin architecture, LLM enrichment as a first-class stage. Historical root of the design; the shipped system diverged substantially. |
| `untrack-build-artifacts.md` | Implemented | Untrack `dist/` and `*.tsbuildinfo` committed by the scaffold PR. |
| `batch-entity-summarization.md` | Superseded | Batch cold-cache entity summarization into one prompt per group in `summarizeEntities`. Predates the current Pass A/B/C interpreter. |
| `legend-fidelity-and-plate-sides.md` | Implemented | Grammar-key legend fidelity (per-skin header, inline SVG swatches) and plate side-count encoding driven by API surface. |
| `plate-shape-call-edges-hop-columns.md` | Implemented | Plate shape/sizing bug, missing call-edge resolution, and the compact hop-column redesign for API Flow / User Journey. |
| `architecture-view-plate-sides-and-sizing.md` | Implemented | Variable polygon sides in Architecture view plus fan-based sizing; confirmed the left-to-right crossing-minimized layout already met design intent. |
| `flows-pass-c.md` | Implemented | Pass C: generate `api_flow` units behind the Flows view. |
| `layer-grouping-and-region-boxes.md` | Implemented | Bucket `layer` units into a small number of named architectural groups and render region boxes around them. Extended by `docs/codebase-analysis.md` §3 (edge-weight input) and later by the hierarchy redesign, which promoted `group` to a real unit. |
| `function-flowchart-extraction.md` | Implemented | Function-internal control-flow extraction (TypeScript + Python) behind the Flowchart view. |
| `pass-a-graph-context-and-cheaper-passes.md` | Implemented | Pass A graph context (callers/callees, bottom-up ordering, cache-key fix), LLM call logging. |
| `review-reconciliation-security-and-correctness.md` | Implemented | Reconciles `docs/review/`: server path traversal, extractor symlink exfiltration, risk-floor bypass, missing runtime validation, dependency CVEs, docs/impl drift. |
| `flowchart-block-labels-readability.md` | Implemented | Semantic block labels (batched per-function LLM step), yes/no edge labels, sequential-block collapsing, flowchart header framing. |
| `test-folder-flat-module-no-analysis.md` | Implemented | Flatten test folders to one module level; skip flowchart/block extraction and all LLM passes for test units. |
| `llm-call-timing-and-progress.md` | Implemented | Per-call LLM timing, sub-phase in-flight progress, duration on INFO lines, end-of-run timing summary. |
| `repo-docs-and-directory-context-for-pass-b-c.md` | Implemented | Pass Docs extraction feeding repo README/`docs/` and directory structure into Pass B/C prompts, plus a Pass B target-cluster-count heuristic. |
| `cli-serve-ui.md` | Implemented | Wire `scv serve` (JSON API) and `scv ui` (static SPA + `/api` proxy) into the CLI. |
| `codedream-ui-migration.md` | Implemented | Migrate the UI onto `packages/design-system` (CodeDream). |
| `api-flow-branching.md` | Implemented | Branch-preserving API flow tracing, including framework DI/middleware steps. Closed `docs/backlog/api-flow-misses-di-middleware.md`. |
| `wave-5-skin-contract.md` | Implemented | Wave 5: a swappable `Skin` contract — `packages/skin-contract`, 2D and 3D hosts routed through it, `tiles3d` wired, `cityscape` (walk/fly + minimap) built, three-way toolbar switch. |
| `wave-5-checkpoint-2-wayfinding.md` | Implemented | Checkpoint 2 findings from driving the street-level camera on `fixtures/orderly`: hue massing works, rank does not survive entering the scene, plus four defects no unit test covered. |
| `remediation-security-clustering-canvas-docs.md` | Implemented | Remediation wave across security, clustering, canvas, and docs drift. |
| `hierarchy-correctness-and-clustering-redesign.md` | Implemented | Root policy with a `test_suite` container, upward tree reciprocity, `validateTreeInvariants` with a reachability assertion, `group` promoted from a string to real snapshot units, then the deterministic-clustering project. All five phases merged (#124–#128). Its deferred group-narration item is only partly closed — see `docs/backlog/group-narration-pass.md`. |
| `deterministic-partition-4c.md` | Implemented | Phase 4c: replaces Pass B's directory-bucket merges with deterministic single-linkage agglomerative clustering, sticky cluster names keyed on a stable membership id, and clustering provenance. |
| `clusters-artifact-split.md` | Implemented | Split the layers/clusters artifact so cached stages can be reused independently. |
| `no-llm-merge-and-provenance.md` | Implemented | `--no-llm` merge-from-cache and per-unit provenance. |
| `agent-authored-semantics.md` | Implemented | `scv merge-semantics`: agent-authored Pass-A semantics injected into the artifact cache at zero LLM cost. Backs the `agent-analyze-functions` skill. |
| `agent-analyze-groups-flows.md` | Implemented | Agent-authored group and flow narration (`--with-groups` / `--with-flows`). Backs the `agent-analyze-groups` and `agent-analyze-flows` skills. This covers the agent-authored path only — a plain `scv analyze` still ships groups with `semantics: null` (`packages/interpreter/src/groups.ts`), so the automated group-narration pass remains open in `docs/backlog/group-narration-pass.md`. |
| `resumable-pass-a-and-analyze-scope.md` | Implemented | Per-unit Pass A result store (`pass_a_units`), resume wiring in `analyze.ts` (`structHashByUnitId` + `priorResults` + `onUnitComplete`), and `--scope` on `analyze`. An interrupted run's completed units now survive into the next one. |
| `agent-analyze-suite-and-flowchart-blocks.md` | Implemented | Completes the agent-analyze skill suite — one skill per `scv analyze` stage, plus the `agent-analyze-repo` umbrella — and fixes the flowchart regression by extracting a deterministic block builder that every zero-LLM path calls. Also makes deterministic stages (`clusters`) genuinely compute under `--no-llm` while refusing to compute over empty-defaulted dependencies. |

## Archive

`archive/` holds plans kept only for history, where the feature was later removed,
rewritten, or the plan was abandoned.

| Plan | Summary |
|---|---|
| `archive/incremental-artifact-analyze.md` | Incremental artifact-aware analyze; superseded by the per-stage artifact caching that shipped. |

## Adding a plan

Write to `~/.claude/plans/` as usual during plan mode, then copy the approved file here
once implementation starts — **renaming it to describe its contents**, not the random slug —
and add a row above with its status. Update the status when the plan's phases land.

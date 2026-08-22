# Plans

Implementation plans produced during Claude Code plan-mode sessions, migrated here from
`~/.claude/plans/` (a local, non-version-controlled directory where filenames are random
slugs and reused slugs silently overwrite prior content). Kept here so plan history is
diffable and durable.

| File | Plan |
|---|---|
| `iterative-bubbling-horizon.md` | Codebase Visualizer (project_viz) — original architecture pipeline |
| `zesty-wishing-meteor.md` | Clean up tracked build artifacts before implementation |
| `draft-it-as-a-abstract-penguin.md` | Batch entity summarization in `summarizeEntities` |
| `can-we-fix-both-gleaming-karp.md` | Fix grammar-key legend fidelity + plate side-count encoding |
| `do-we-have-the-cuddly-meerkat.md` | Visualization fixes & compact hop-column redesign |
| `look-into-what-shows-abstract-valley.md` | Variable sides in Architecture view, fan-based sizing |
| `flows-pass-c.md` | Pass C: generate `api_flow` units (Flows view) |
| `soft-bubbling-valley.md` | Group layers into architectural groups, render region boxes |
| `function-flowchart-extraction.md` | Function-internal flowchart extraction (TypeScript + Python) |
| `pass-a-graph-context-and-cheaper-passes.md` | Pass A graph context (callers/callees, bottom-up ordering, cache-key fix), LLM call logging, drop fewer/cheaper-pass gaps |
| `review-reconciliation-security-and-correctness.md` | Reconciles `docs/review/` findings: server path traversal, extractor symlink exfiltration, risk-floor bypass, missing runtime validation, dependency CVEs, docs/impl drift |
| `flowchart-block-labels-readability.md` | Semantic block labels (batched per-function LLM step), yes/no edge labels, sequential-block collapsing, flowchart header framing |
| `test-folder-flat-module-no-analysis.md` | Flatten test-folder hierarchy to one module level, skip flowchart/block extraction and all LLM passes for test units |
| `llm-call-timing-and-progress.md` | Per-call LLM timing, sub-phase in-flight progress logging, duration on INFO lines, end-of-run timing summary |
| `repo-docs-and-directory-context-for-pass-b-c.md` | Feed repo docs (README/`docs/`) + directory structure into Pass B/C prompts via new Pass Docs extraction pass, plus Pass B target-cluster-count heuristic |
| `cli-serve-ui.md` | Wire `scv serve` (JSON API) and `scv ui` (static SPA + `/api` proxy) into the `scv` CLI |
| `wave-5-skin-contract.md` | Wave 5: a real, swappable `Skin` contract plus a 3D view you can move through — `packages/skin-contract`, both 2D and 3D hosts routed through it, `tiles3d` wired, `cityscape` (walk/fly + minimap) built, three-way toolbar switch |
| `wave-5-checkpoint-2-wayfinding.md` | Wave 5 Checkpoint 2: what the street-level camera on `fixtures/orderly` actually showed — hue massing works, rank does not survive entering the scene, and four defects no unit test was asking about |
| `hierarchy-correctness-and-clustering-redesign.md` | Reconciles the 2026-08-21 review: root policy with a `test_suite` container for coverage-only test modules, upward tree reciprocity (layer/flow `parent`), `validateTreeInvariants` with a reachability assertion, `group` promoted from a string to real snapshot units (contracts then migration), then the deterministic-clustering project (quality metrics, adversarial fixture, seeded community detection) |
| `dapper-drifting-fern.md` | Fix 3D-skin navigation and scale gaps: cityscape fly-drag (`FlyControls` rotates by cursor-offset-from-centre, not drag delta) and the compass symptom it likely explains, focus render order, continuous-zoom drill/ascend, building shape legibility + sloc height rescale under Checkpoint 2's slab constraint, always-visible legend tray, controls-help guide, large-repo layer count |
| `deterministic-partition-4c.md` | Phase 4c execution plan: replaces Pass B's directory-bucket merges (which cannot split a directory) with the deterministic algorithm above — corrected from average to single linkage, which the 4b fixture proves is required — plus sticky cluster names keyed on the stable membership id, and clustering provenance |

New plans: write to `~/.claude/plans/` as usual during plan mode, then copy the approved
file here (and commit) once implementation starts, so its history is preserved.

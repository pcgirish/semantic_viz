# Roadmap

Status as of 2026-10-29. Source of truth for granular history: `docs/plans/`
(implemented, chronological) and `docs/backlog/` (deferred/closed items).

## Done — core pipeline (all packages "Implemented")

- **Extractor** — Python + TypeScript via tree-sitter; imports/calls
  resolved to units/edges; manifest parsing (`requirements.txt`,
  `package.json`); git churn/authorship; deterministic hashing
- **Schema** — Zod + generated JSON Schema for `SymbolGraph`/`UnitGraph`
- **Interpreter** — Pass A (leaf semantics + branch labels), Pass Docs
  (repo README/docs extraction), Pass B (deterministic agglomerative
  single-linkage file clustering — no LLM), Pass C (architecture narration
  + branch-preserving API flow tracing incl. framework DI/middleware;
  Pass C-groups), Pass D (five-axis risk narration) + inspect-queue
  ranking; pluggable `Provider` (ollama/anthropic/claude-cli) + content
  cache
- **Differ** — match/classify/blast-radius/rollup; `added`/`removed`/
  `modified`/`risk_changed` (rename/move detection deliberately
  unsupported)
- **CLI** — `scv analyze` / `scv diff` (package `semviz`); `scv-viewer serve` / `scv-viewer ui` (package `@semviz/viewer`), incremental
  and artifact-aware (per-stage caching under `.scv/artifacts/<sha>/`);
  `scv merge-semantics` injects agent-authored semantics into that cache
- **Agent-analyze skill suite** (`.agents/skills/agent-analyze-*`) — one
  skill per `analyze` stage plus an `agent-analyze-repo` umbrella, producing
  a complete snapshot with zero provider calls. Deterministic stages
  (extraction, blocks, clustering) really compute under `--no-llm`; a
  deterministic stage refuses to compute over empty-defaulted dependencies
  rather than writing a cache-fresh artifact derived from nothing
- **Server** — Fastify API (`/api/revs`, `/api/snapshot/:sha`,
  `/api/search`, `/api/delta/:from/:to`)
- **Layout** — pure Sugiyama-style layered engine (rank/order/place/route)
- **Skins** — `tiles` (SVG, 2D), `tiles3d` (three.js orbit), `cityscape`
  (walk/fly + minimap), unified under `skin-contract`
- **Committed semantics** — `scv export` / `hydrate` / `check` / `init`
  publish agent-authored semantics to `.scv/semantics/`, seed any revision
  from it, and gate PRs on freshness; this repo commits its own store
  (`docs/plans/publishable-committed-semantics.md`)
- **UI** — Current / Delta / Depends-on / API Flow / Flowchart views,
  Replay timeline, search, fully migrated to `packages/design-system`
  (CodeDream)

## Done — hierarchy correctness & clustering redesign

**Hierarchy correctness & clustering redesign**
(`docs/plans/hierarchy-correctness-and-clustering-redesign.md`) —
structurally sound navigation hierarchy. Landed so far:

- Single-root policy — every unit but the system has a parent; test
  modules sit in a `test_suite` container
- Referential-integrity validators (severity-tiered: structural defect vs.
  legacy artifact)
- Real `group` units built deterministically from layer ids (not
  LLM-chosen names), with rollup edges carrying concrete edge counts
- Connected-siblings tray — focusing a group still shows its coupling to
  the rest of the system, as hoverable/pinnable rows that fill the tiles
  involved by edge direction rather than as tiles in scene space
- Deterministic clustering with an adversarial fixture, algorithm/
  thresholds recorded in snapshot provenance, explicit split/merge lineage
  across revisions
- Edge roll-up with provenance, per-level budgets (120-connector cap,
  ranked), unresolved/inferred edges rendered dashed

This plan's phases (1–5) are complete per the latest merged PRs; the
project ships the closing line "every phase in it is now implemented and
merged" in `README.md`.

## Recently closed backlog items

- **API Flow missed framework DI/middleware steps** (closed 2026-08-08) —
  resolved alongside branch-preserving API flow tracing
- **Canvas pan/zoom** (closed 2026-08-20) — pan/zoom/fit landed; a
  layout-axis (left-to-right) change remains open, tracked separately

## Known open issues

- Nothing is published to npm yet: the packages are publish-ready, but
  publishing needs an npm account and the `semviz` org; until then scv is
  used from a clone (`npm link`)
- `scv init --install git` generates a workflow that clones scv at a pinned
  ref, which only works in other repos while this repo is publicly cloneable

- Layout ranks stack top-to-bottom; the left-to-right rank axis change from
  PR #80 (deferred alongside canvas pan/zoom, which has since shipped) never
  landed — `docs/backlog/layout-left-to-right-axis.md`
- Light skin's canvas background vignette is hardcoded for the dark skin
  (`GraphCanvas` radial-gradient) — tracked as a followup, not part of any
  active plan
- Temperature scale is misused: the Inspector's `RiskMeter` paints
  `semantics.confidence` on the risk ramp (high confidence reads as
  critical red), and the Legend shows the ramp in Current where nothing
  reads it — `docs/backlog/temperature-scale-misuse.md`
- Modules are never narrated: `LEAF_KINDS` covers functions and classes,
  layers and groups are synthesized, and `kind: "module"` falls between
  both — so a module has no what/how/when/where/why and no name but its
  file path — `docs/backlog/module-tier-not-narrated.md`

## Future work (not yet planned in `docs/plans/`)

- `docs/llm-call-observability.md` — cost-in-USD assignment, the
  file-duplication *analysis*, and any surface for the trace. Per-call token
  logging (`llm_calls` table) and in-run progress logging have shipped, but
  nothing reads those rows beyond the `scv analyze` summary: the cache DB is
  CLI-local, the server never opens it, and no UI shows tokens or cost (the
  UI's `cost` field is the Interpreter's complexity estimate, not LLM spend).
  CLI-only `scv usage` recommended before any UI/schema commitment. Two scope limits
  are settled and recorded there: the Anthropic API's cache-token fields are dropped
  at the response-type parse, so no recorded run can be turned into a bill until
  `docs/backlog/cache-token-capture.md` lands (a prerequisite for the prompt-prefix
  work, which is otherwise unmeasurable); and the **agent-analyze route has no such
  metrics by construction** — it makes zero provider calls, so tokens/cost/latency
  have nothing to measure, and coverage is the comparable metric there instead
- Group-narration pass — groups currently ship with `semantics: null`
  and no cross-commit name carry-over, so an LLM-chosen group name can
  drift between commits even when membership is unchanged. The
  agent-authored `--with-groups` path (PR #144) makes narrated groups
  reachable by hand, but the automated pass is still unbuilt — tracked in
  `docs/backlog/group-narration-pass.md`

## Validation baseline

Both pillars are checked against `fixtures/orderly`:

`fixtures/orderly` is a nested git repo, gitignored here; `npm run test`
restores it from the committed `fixtures/orderly.bundle` when missing. After
committing to the fixture's `main`, run `npm run fixtures:bundle` and commit the
bundle.

- **Current** — the extractor/interpreter pipeline runs end to end on it
  every analyze run; units, edges, clustering, and narration are exercised
  on real, non-trivial code.
- **Delta** — inspect-queue coverage: 7/7 ground-truth entities surfaced
  (exact coverage; rank *order* not yet matched — attributed to underlying
  model quality, not a code defect). This is the project's standing
  correctness bar for the Differ + ranking pipeline.

# Roadmap

Status as of 2026-08-24. Source of truth for granular history: `docs/plans/`
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
- **CLI** — `scv analyze` / `scv diff` / `scv serve` / `scv ui`, incremental
  and artifact-aware (per-stage caching under `.scv/artifacts/<sha>/`)
- **Server** — Fastify API (`/api/revs`, `/api/snapshot/:sha`,
  `/api/search`, `/api/delta/:from/:to`)
- **Layout** — pure Sugiyama-style layered engine (rank/order/place/route)
- **Skins** — `tiles` (SVG, 2D), `tiles3d` (three.js orbit), `cityscape`
  (walk/fly + minimap), unified under `skin-contract`
- **UI** — Current / Delta / Depends-on / API Flow / Flowchart views,
  Replay timeline, search, fully migrated to `packages/design-system`
  (CodeDream)

## In progress

**Hierarchy correctness & clustering redesign**
(`docs/plans/hierarchy-correctness-and-clustering-redesign.md`) —
structurally sound navigation hierarchy. Landed so far:

- Single-root policy — every unit but the system has a parent; test
  modules sit in a `test_suite` container
- Referential-integrity validators (severity-tiered: structural defect vs.
  legacy artifact)
- Real `group` units built deterministically from layer ids (not
  LLM-chosen names), with rollup edges carrying concrete edge counts
- Group boundary markers — focusing a group still shows its coupling to
  the rest of the system
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

- Light skin's canvas background vignette is hardcoded for the dark skin
  (`GraphCanvas` radial-gradient) — tracked as a followup, not part of any
  active plan
- Pass A against a large repo (hundreds of units) on a local `ollama`
  daemon can exceed concurrent-connection limits (`fetch failed`) —
  workaround is analyzing a subtree or switching to a hosted provider

## Future work (not yet planned in `docs/plans/`)

- `docs/llm-call-observability.md` — per-call token/cost logging,
  file-duplication detection
- Check-in split: `scv export --structural` for committing deterministic
  (non-LLM) snapshot data
- Group-narration pass — groups currently ship with `semantics: null`
  and no cross-commit name carry-over, so an LLM-chosen group name can
  drift between commits even when membership is unchanged (deferred in
  `docs/plans/hierarchy-correctness-and-clustering-redesign.md`)

## Validation baseline

Both pillars are checked against `fixtures/orderly`:

- **Current** — the extractor/interpreter pipeline runs end to end on it
  every analyze run; units, edges, clustering, and narration are exercised
  on real, non-trivial code.
- **Delta** — inspect-queue coverage: 7/7 ground-truth entities surfaced
  (exact coverage; rank *order* not yet matched — attributed to underlying
  model quality, not a code defect). This is the project's standing
  correctness bar for the Differ + ranking pipeline.

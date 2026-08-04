# semantic_viz Project-Level Review

Date: 2026-08-04  
Scope: design, architecture, modules, functions, flows, implementation, performance, operating cost, usability, testing, and delivery readiness.  
Baseline: `main` at `dc4fe57`.

## Verdict

**NEEDS CHANGES**

The project has a coherent product direction and a healthy package decomposition, but it is not yet ready to be treated as a complete, production-oriented product. The largest risks are interpretation quality, the gap between the documented CLI/storage architecture and the shipped implementation, and the absence of bounded/resumable analysis execution.

The separate security review is in [codex-review.md](./codex-review.md). This document focuses on overall product and engineering readiness.

## Executive summary

### What is working well

- The product model is clear: deterministic source facts are combined with LLM-generated semantic interpretation, then rendered as snapshots and deltas.
- The package dependency direction is mostly clean: schema is foundational; extractor, interpreter, differ, layout, server, and UI have understandable responsibilities.
- Zod-backed schemas, provider abstraction, content caching, deterministic graph checks, and pure layout/skin boundaries are strong foundations.
- The UI already communicates useful concepts: Current, Delta, Depends-on, Flows, confidence, source evidence, replay, zoom/pan, and directional hover behavior.
- The current automated suite is substantial: 507 tests across 63 files pass, lint passes, and TypeScript build passes.

### Highest-impact issues

1. Pass B and Pass C receive `"(no summary)"` for every file in the normal orchestration path. Architecture and cluster narration therefore operate mostly on imports and filenames, not Pass A semantics.
2. The documented product surface is ahead of the implementation. `scv init`, `export`, and `serve` are not implemented; the server does not serve the SPA or provide the documented queue endpoint; storage is filesystem JSON rather than the documented SQLite index.
3. Valuable semantic data is discarded. Extracted parameters/returns and Pass A `ports` do not reach snapshot `Unit.signature`, so the inspector reports no signature for normal units.
4. Incremental analysis, extractor caching, bounded provider calls, timeouts, progress, and resume are largely design goals rather than implemented behavior.
5. The UI is useful for a prepared snapshot, but error recovery, search, deep links, keyboard access, responsive behavior, and the documented large-graph rendering strategy are incomplete.

## Product and design review

The design in `docs/design.md` has a good central abstraction:

```text
repository -> structural extraction -> symbol graph -> LLM interpretation
           -> snapshot -> diff/risk analysis -> server/API -> visual UI
```

The distinction between structural facts, semantic judgments, and code deltas is valuable and should remain. The three-hash model (structural, text, semantic) also provides a useful basis for caching and reproducibility.

The design is strongest as a model of the data and views. It is weaker as an operational contract. The docs describe incremental extraction, structural-only history, SQLite indexing, a combined CLI, worker isolation, cost confirmation, and large-graph rendering thresholds, while the current implementation still follows a full local scan, direct provider orchestration, JSON-file storage, and a separate UI development server.

Recommended design decision: define an explicit MVP contract and mark all later capabilities as planned. The current system should either implement the documented workflow or revise the docs so users are not asked to depend on commands and behavior that do not exist.

## Architecture and module review

### Package boundaries

The dependency direction is a strength:

| Area | Responsibility | Assessment |
| --- | --- | --- |
| `schema` | Snapshot, delta, graph, and LLM result contracts | Good foundation; should be the runtime boundary everywhere |
| `extractor` | Tree-sitter parsing, manifests, VCS, symbol resolution | Useful deterministic layer; repeated scans and linear lookups limit scale |
| `interpreter` | Provider calls, prompts, cache, semantic passes | Correct seam, but orchestration context and execution bounds need work |
| `differ` | Structural delta and risk interpretation | Good separation; rollups and risk floor need correctness fixes |
| `cli` | User-facing composition and persistence | Currently thin and incomplete compared with documented workflow |
| `server` | Snapshot/delta API | Simple and understandable; storage strategy is not scalable yet |
| `layout` / `skins` | Rendering geometry and visual treatment | Good extensibility seam; 3D skin is not wired into the UI |
| `ui` | Current/delta/replay/flow exploration | Strong MVP interaction model; accessibility and failure states need attention |

### Key architectural finding: broken semantic context propagation

`packages/interpreter/src/orchestrate.ts` runs Pass A for leaf functions/classes. It then builds `unitsByFile` from module units and looks for a semantic summary there. Module units do not receive Pass A semantics, so the resulting `oneLiners` map falls back to `"(no summary)"` for normal files.

This means:

- Pass B clustering is effectively driven by import edges and fallback names.
- Pass C architecture narration lacks the intended file summaries.
- Tests that inject `oneLiners` directly pass while the production orchestration path remains under-tested.

This is a priority correctness issue, not merely a prompt-quality improvement. Roll up leaf semantics by file, define the rollup rule, and add an orchestration test that asserts the generated Pass B/C prompts contain the expected summaries.

### Data contract loss

`packages/extractor/src/resolve.ts` extracts parameter and return information. `packages/interpreter/src/pass-a.ts` parses `ports`, but the response is not carried into the snapshot. `packages/cli/src/snapshot.ts` writes `signature: null`.

The result is a broken end-to-end contract: the UI inspector has a signature display, but normal analyzed units cannot populate it. Preserve the validated Pass A ports in the snapshot model, or explicitly remove the unused field from the design and UI.

### Documentation-to-implementation drift

The current CLI entrypoint exposes `analyze` and `diff`; the documented `init`, `export`, and `serve` commands are absent. The server starts directly from `packages/server/src/bin.ts`, exposes API routes, and does not serve the built SPA. The documented queue endpoint is absent. `packages/server/src/store.ts` scans and parses JSON snapshot files rather than using the documented SQLite index.

This creates a high-friction onboarding path and makes operational assumptions unclear. Treat the CLI and storage contract as a release gate: either implement the documented path end to end or revise the docs and README to the actual path.

## Flow review

### Analyze flow

1. CLI extracts a repository into a structural graph.
2. Git metadata is read and a snapshot identity is created.
3. A provider and content cache are created.
4. Interpreter passes run: Pass A, block/cluster interpretation, Pass B, Pass C, and system/flow work.
5. A snapshot is written under `.scv/snapshots` only after orchestration completes.
6. The server later reads snapshot files and the UI fetches full snapshots or deltas.

The main flow is easy to follow, but failures in later passes lose the in-memory run result. Cache entries survive, yet there is no progress record or resumable checkpoint from which the next invocation can continue.

### Diff flow

1. Two snapshots are loaded.
2. Structural changes are calculated.
3. Changed modules receive Pass D risk analysis.
4. Small candidate sets receive an LLM ranking call; larger sets fall back to deterministic scoring.
5. The delta is persisted and served to the UI.

This is a sensible fallback strategy. Pass D currently uses unbounded `Promise.all`, which can create a provider burst proportional to the number of changed modules. Add a concurrency limit, cancellation, and a visible analysis status.

## Implementation and function-level findings

### High priority

- Fix Pass B/C context construction in `packages/interpreter/src/orchestrate.ts` and cover the complete orchestration path with prompt assertions.
- Preserve `ports`/signature information from Pass A through `packages/cli/src/snapshot.ts`.
- Correct the documented risk formula floor in `packages/differ/src/diff-with-risk.ts`; the current assignment can replace the floor with a lower LLM score.
- Correct removed-unit rollups in `packages/differ/src/diff.ts`; ancestor rollups currently prefer nonempty `unitsB`, which can omit removed units present only in A.
- Add runtime schema validation at file and API boundaries. TypeScript types do not protect JSON snapshots, request bodies, or external provider responses at runtime.

### Medium priority

- Add provider timeout, cancellation, retry policy, and error classification for Anthropic, Ollama, and CLI-backed providers.
- Add prompt-size and source-size budgets. Pass A may repeat large class/function bodies; Pass B/C resend context; no clear token cap is enforced before provider calls.
- Make analysis writes atomic and record progress/checkpoints before the final snapshot write.
- Replace repeated resolver scans with indexed symbol/file maps where repository size warrants it; current `find`/`some` patterns can become quadratic on large graphs.
- Bound or report content-cache growth. There is no visible eviction, size limit, or cache maintenance workflow.

## Performance and scalability

### Current costs

Cold analysis makes approximately:

```text
Pass A leaf calls + Pass C cluster calls + 1 group call
+ 1 flow-entry proposal call + 1 call per narrated flow
```

Retries increase this count. Pass A is limited to two concurrent calls, while Pass C and flow narration are largely sequential. This protects provider load but can make large repositories slow. No cost estimate or confirmation is currently shown even though the implementation plan describes one.

The extractor rescans directories, stats, reads, parses manifests, and runs full Git history work on each analysis. The documented blob-hash extractor cache is not present; only LLM content caching is implemented.

### Server and UI costs

- `server/store.ts` reparses all relevant JSON files for many operations, including revision listing, search, and adjacent-delta discovery.
- Synchronous filesystem work runs inside request handlers.
- UI fetches full snapshots/deltas even when rendering only a focused subset.
- `CanvasHost` uses SVG DOM elements and rebuilds the visible graph; the documented Canvas fallback for large graphs is not implemented.
- Layout documentation reports synthetic crossing targets above the stated goal and identifies Brandes–Köpf work as future improvement.

Recommended sequence: measure first with a small repository, a medium fixture, and a long revision history; then implement content-addressed extraction, SQLite/indexed reads, bounded graph payloads, and a rendering threshold based on measured budgets.

## Operating cost

The cost model is currently opaque:

- Anthropic calls are metered, but the product does not estimate or display expected calls/tokens.
- Ollama avoids provider billing but consumes local CPU/GPU, memory, and time.
- The CLI provider consumes its own plan/quota and has different failure/latency behavior.
- Retries, long prompts, repeated class bodies, and Pass C/flow calls are the main cost multipliers.
- The cache reduces repeat cost but can grow indefinitely and has no user-facing hit-rate or size information.

Add a run summary containing provider/model, cache hits/misses, input/output tokens when available, call count, elapsed time, estimated cost, and skipped/failure counts. Add an explicit confirmation threshold for remote providers and a structural-only mode that never invokes an LLM.

## User friendliness and pain points

### Current strengths

- The views correspond to real review questions: what exists, what changed, what depends on a unit, and what flows through it.
- Inspector text distinguishes source facts from LLM interpretation and confidence.
- Replay metadata and delta views give the product a useful review narrative.
- React rendering escapes dynamic text, and the UI has clear basic loading/error components.

### Current pain points

- Setup requires separate build/analyze/server/UI steps; the promised single `scv serve` workflow is unavailable.
- A failed `/api/revs` boot has no reliable recovery path; the boot promise is not handled and the visible error state has no retry or diagnostics.
- The server exposes search, but the UI has no search control.
- Selected revision, focus, and view mode are not encoded in the URL, so refresh and sharing lose context.
- Graph nodes and flow steps are primarily mouse interactions; keyboard focus, semantic controls, and ARIA labeling are incomplete.
- Flowchart mode is hidden behind a double-click interaction, with little discoverability.
- Fixed rail/inspector sizing and the SVG-only rendering path are likely to be uncomfortable on narrow screens and large graphs.
- Short SHA-only revision labels provide little context without opening replay metadata.

Prioritize an integrated startup command, retryable failure states, URL-addressable views, visible mode controls, search, keyboard-accessible controls, and a small responsive layout pass.

## Testing and verification

Executed on the review baseline:

- `npm test` — pass; 63 files and 507 tests.
- `npm run lint` — pass.
- `npm run build` — pass.

The suite gives good package-level confidence, but it does not sufficiently protect the product contract. Add:

- an extract-to-snapshot integration fixture;
- an orchestration test that verifies Pass A semantics reach Pass B/C prompts;
- a golden snapshot/delta fixture covering removed units and signatures;
- server tests for long histories, indexing behavior, and malformed persisted JSON;
- an end-to-end test of the built UI against the server;
- accessibility checks for keyboard navigation and labels;
- performance tests for resolver, server history, layout, and 200/800+ node rendering;
- coverage thresholds for the critical packages.

## Recommended delivery plan

### P0 — restore correctness and product truth

1. Fix Pass B/C semantic context propagation.
2. Preserve signatures/ports and fix delta risk-floor and removed-unit rollup behavior.
3. Add runtime validation for persisted snapshots, API inputs, and provider outputs.
4. Reconcile README/design docs with the actual CLI/server behavior.

### P1 — make analysis dependable

1. Add provider timeouts, bounded concurrency, cancellation, retry classification, and prompt/token budgets.
2. Add progress/checkpoint persistence and resumable runs.
3. Implement extractor caching by content identity and avoid unnecessary Git/manifests work.
4. Add run cost/usage telemetry and remote-provider confirmation.

### P2 — make the product usable at project scale

1. Implement the integrated `init`/`export`/`serve` workflow or formally replace it with the supported workflow.
2. Add SQLite/indexed storage, pagination, focused graph payloads, and asynchronous server reads.
3. Add UI search, retryable errors, deep links, visible mode controls, accessibility, and responsive layout.
4. Add Canvas/WebGL or another measured large-graph strategy and benchmark against stated targets.

## Final assessment

The project is a promising and thoughtfully decomposed prototype with meaningful end-user value already visible in the UI. It needs a correctness-and-contract pass before more views or skins are added. The best next milestone is not another visualization surface; it is a reliable, bounded, reproducible analysis pipeline whose output preserves the semantic data the UI promises and whose documented workflow matches what users can actually run.

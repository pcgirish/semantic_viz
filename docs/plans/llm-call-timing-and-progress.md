# LLM call timing, phase progress, and analysis-run summary

## Context

`docs/llm-call-observability.md` already tracks token/cost visibility and explicitly flags
the next gap ("Progress during the run, not just a summary after"): a full-repo `scv analyze`
against a local Ollama model takes minutes across ~500+ Pass A calls at
`PASS_A_CONCURRENCY = 2`, and today the CLI is silent until the final `wrote .scv/snapshots/…`
line — `orchestrate.ts` only logs on Pass A/A-blocks failure. Separately, no call or run
duration is measured anywhere: `ProviderResult`/`ProviderUsage`/`LlmCallRecord`/`logLlmCall`
all capture tokens but not timing. This plan adds per-call duration, a phase-level progress
line (`phase, count_done/count_total`) during the run, duration on every INFO log line, and a
timing summary printed at the end — reusing the existing interception points rather than
adding a new mechanism.

## Plan

**1. Time each LLM call in `CachedProvider.interpret()`.**
`packages/interpreter/src/cached-provider.ts:32-58` is the single funnel every `interpret()`
call already passes through (cache hit or real call). Wrap the inner call with
`performance.now()` bookends; record `durationMs` for both the cache-hit path (near-zero,
still worth recording for the progress line's "done" tick) and the real-call path.
- Add `durationMs: number` to `LlmCallRecord` (`packages/interpreter/src/cache.ts:11-19`) and
  to the `llm_calls` table (`ALTER TABLE`-style migration guard, same pattern used at
  cache.ts:46-51 for `input_tokens`/`output_tokens`); thread it through `logCall`/`listCalls`.
- Extend `ProviderUsage` (`provider.ts:26-31`) with running `totalDurationMs` (and optionally
  `minCallMs`/`maxCallMs`) so `CachedProvider.usage` (cached-provider.ts:28-30) exposes
  aggregate timing the same way it exposes token totals today, per-phase breakdown left to
  the sqlite `llm_calls` rows (already keyed by `pass`) rather than duplicating per-phase
  state in-memory.

**2. Add duration to the INFO log line.**
`logLlmCall` (`packages/interpreter/src/log.ts`) takes a `LlmCallLog`; add `durationMs: number`
to that interface and append `duration_ms=${call.durationMs}` to the existing
`[INFO] llm-call ...` format string. The call site for `logLlmCall` (search for its only
caller — likely alongside `cache.logCall` in `cached-provider.ts` or wherever call metadata is
assembled) passes the same `durationMs` computed in step 1.

**3. Phase-level progress line: `phase, count_done/count_total`.**
`orchestrate.ts` already has clean phase boundaries and known totals up front:
- Pass A: `processingOrder.length` total, ticked inside the `runInDependencyOrder` callback
  at orchestrate.ts:144-190 (after `passAResultById.set(...)`, success or caught-error path).
- Pass A-blocks: `functionsWithBlocks.length` total, ticked inside the callback at
  orchestrate.ts:221-236.
- Pass B: 1 total, 1 call (orchestrate.ts:326) — print before/after, no counter needed.
- Pass C (per-cluster layer narration): total = `Object.keys(passB.clusters).length`, but
  today `runPassC` (`pass-c.ts`) takes the whole `clusters` map and returns all layers in one
  call — confirm during implementation whether it's actually one call total or one per
  cluster; tick accordingly (if it's one call total like Pass B/Pass C-Groups, treat it the
  same as those: print before/after, no per-item counter).
- Pass C-Groups: 1 total (orchestrate.ts:368).
- Flow entry points + per-entry narration: 1 call for `proposeFlowEntryPoints`
  (orchestrate.ts:416) + `entryPoints.length` calls for `narrateFlow`
  (orchestrate.ts:419-468), ticked inside that `for` loop.

Add a small
`reportProgress?: (phase: string, done: number, total: number, current?: string) => void`
field to `RunInterpreterOptions` (orchestrate.ts:79-87). Capture `runStart = performance.now()`
once at the top of `runInterpreter`, before Pass A begins, and default `reportProgress` to a
`console.error` line that includes cumulative wall clock since `runStart`:
`[INFO] progress phase=${phase} ${done}/${total} current=${current ?? ""} elapsed=${fmt(performance.now() - runStart)}`
— mirrors how `readSource` is already an injectable option with a default. `fmt` renders
elapsed ms as e.g. `1m42s` (small helper, reused by step 4's final summary so the format is
consistent between per-line and end-of-run elapsed time). The
`current` argument names the entity actually in flight, not just the count, which matters
most for Pass A/A-blocks/flow narration where `PASS_A_CONCURRENCY = 2` (and higher
concurrency elsewhere) means more than one entity is in progress at once:
- Pass A / Pass A-blocks: since `runInDependencyOrder` (orchestrate.ts:27-77) dispatches up
  to `limit` concurrently, report progress twice per unit — once when dispatched (`current`
  = qualname, `done` unchanged, so a "now processing X, Y" line is visible while both are
  in flight) and once when it resolves (`done` incremented). Simplest implementation: call
  `reportProgress` at the top of the `fn(id)` callback (dispatch) and again after
  `passAResultById.set(...)` (completion), distinguishing the two with a `status: "start" |
  "done"` argument if a single callback needs to represent both, or two thin wrapper calls —
  decide the exact shape during implementation, but both events must be observable so a log
  consumer can reconstruct "currently in process: [X, Y]" at any point, not just the last
  completed one.
- Pass B / Pass C-Groups / propose-entry-points (single-call phases): report `current` as
  the phase's own descriptive label (e.g. `"clustering files"`) since there's no per-entity
  loop to name.
- Flow narration (`entryPoints` loop, orchestrate.ts:419-468): report `current` = `entry.name`
  or `entry.route` per iteration, same start/done pairing as Pass A.

Throttling (e.g. every Nth unit) only if plain per-call logging turns out too noisy in
practice — start with per-call, per the observability doc's own "minimal version" note.

**4. Overall run timing + end-of-run summary.**
`packages/cli/src/analyze.ts` (`runAnalyze`, lines 47-90) is the natural place to bookend the
whole run: capture `performance.now()` before `runInterpreter` and after, plus per-phase
totals pulled from the new `ProviderUsage.totalDurationMs` (step 1) and/or the sqlite
`llm_calls` rows grouped by `pass` (already queryable via `cache.listCalls()`,
cache.ts:86-109 — group in `analyze.ts` or a small helper, no new table needed since `pass`
is already a column). `bin.ts` (lines 27-31) already prints a usage summary after
`runAnalyze()` returns; extend that block with a wall-clock total and a per-phase duration
breakdown, e.g.:
```
elapsed: 4m12s (pass A: 3m40s, pass A-blocks: 20s, pass B: 2s, pass C: 8s, flows: 2s)
usage: input tokens=..., output tokens=..., calls=..., cache hits=...
```

## Verification

- TDD throughout (CLAUDE.md): failing test before implementation, each step.
  - `cache.test.ts` (or wherever `ContentCache`/`logCall` is tested): assert `durationMs` is
    persisted and returned by `listCalls()`.
  - `cached-provider.test.ts`: assert `usage.totalDurationMs` increases after `interpret()`,
    and that a cache-hit call still records a (near-zero) duration.
  - `log.test.ts`: assert the INFO line contains `duration_ms=`.
  - `orchestrate.test.ts`: assert `reportProgress` is invoked with correct `(phase, done,
    total, current)` tuples across Pass A / Pass A-blocks / flow narration, including a
    dispatch-time call naming the in-flight qualname before its matching completion call, using
    a fake provider with a controllable delay if needed to assert overlap under
    `PASS_A_CONCURRENCY = 2`; assert elapsed time is non-decreasing across successive calls.
  - `analyze.test.ts` (cli package): assert `RunAnalyzeResult` (or the printed summary) carries
    a total elapsed duration.
- `npm run lint && npm test` after each step.
- Manual: run `scv analyze` on `fixtures/orderly` via ollama (never claude-cli by default),
  confirm progress lines stream during the run and the final summary shows a sane per-phase
  breakdown that sums close to the wall-clock total.

## Out of scope

- Cost-in-USD (`cost_usd` field) — already tracked as separate future work in
  `docs/llm-call-observability.md`, not part of this plan.
- A real redrawing progress bar / ETA — the observability doc explicitly defers this; this
  plan only does sequential `phase done/total` logging.
- File-duplication analysis via the sqlite log — unrelated existing future-work item.

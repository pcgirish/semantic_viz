# LLM call concurrency is a hardcoded 2, and Pass Docs is unbounded

**Status:** open
**Found:** 2026-08-26

## Problem
Concurrency is set in the orchestrator, not per provider, so ollama, anthropic,
and claude-cli all get identical treatment. Two separate issues:

### 1. `PASS_A_CONCURRENCY = 2` is hardcoded

`packages/interpreter/src/orchestrate.ts:26` sets the limit as a module constant.
There is no flag, no `config.yaml` key, and no per-provider override. It is used
for both Pass A (`:268`) and Pass A-blocks (`:361`).

2 is a defensible default for a local ollama on one GPU, where the model is the
bottleneck and more parallelism mostly adds contention. It is the wrong number for
a cloud provider: against Anthropic or OpenAI the ceiling is API rate limits, and
much higher concurrency would be fine. The same constant governs both.

Observed scale: a run against `../eq_to_word_problem` took ~1196s of provider time
across 46 Pass A calls (`llm_calls` table). Concurrency is plausibly the largest
single lever on analyze wall time.

### 2. Pass Docs is unbounded

`packages/interpreter/src/pass-docs.ts:40` uses a bare `Promise.all` over the doc
set with no limit, unlike every other pass. On a repo with many docs that dispatches
every call at once — inconsistent with the rest of the pipeline, and against a local
model it could contend badly.

## Not a defect: Pass A's ordering
`runInDependencyOrder` (`orchestrate.ts:35-80`) is deliberately not a plain worker
pool. Pass A runs bottom-up because a unit's prompt carries its callees' semantics,
so a unit is only dispatched once its callees are done (`isReady`, `:47-51`). The
limit is therefore a **ceiling, not a steady state** — on a dependency chain the
effective parallelism is 1 no matter what the limit says. Any change to the limit
should be measured, not assumed to scale linearly.

The cycle escape at `:63-70` (force-pick the earliest remaining id when nothing is
ready and nothing is in flight) is also deliberate — a dependency cycle would
otherwise deadlock. Preserve it.

## Pass C and Pass B
Pass C is serial by construction — plain `for` loops awaiting one call at a time
(`pass-c.ts:65`, `:136`, `:167`) plus single calls at `:184`, `:224`, `:271`. Its
call count is small (layers, then groups), so this is low priority. Pass B makes no
LLM calls at all; it is the deterministic clustering.

## Possible fix
Thread the limit through `InterpreterConfig` (`config.ts`) with a per-provider
default — a low number for ollama, a higher one for cloud providers — and give
Pass Docs a bounded map instead of `Promise.all`. Measure against a real repo before
picking values; per the ordering note above, the speedup will not be linear.

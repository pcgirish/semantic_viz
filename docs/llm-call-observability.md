# LLM call observability

Token direction reporting, the per-call SQLite trace, and in-run progress logging are all
implemented. What remains is cost-in-USD assignment and the file-duplication *analysis* —
the trace records `file` per call, but nothing queries it yet. This document tracks both
the shipped reporting and the follow-up design, prompted by two things found while fixing
layer semantics: Pass A/B/C calls had no visibility into token cost, and Pass A sends one
prompt per leaf unit — with, it was supposed, a shared file's source re-sent once per unit.
That second premise has since been **disproved** by the logging this document motivated;
Pass A slices per-unit spans, not whole files. See the correction below.

**Status verified against code 2026-08-26.** Shipped: `ProviderResult` in/out tokens
(all three providers), the `llm_calls` table (`packages/interpreter/src/cache.ts:95`,
columns `pass, unit_id, qualname, file, in_tokens, out_tokens, cache_hit, duration_ms,
ts`), and per-unit progress via `reportProgress` (`orchestrate.ts:272`). Not built:
`cost_usd`, any query/report over the recorded `file` column, and any surface beyond the
`scv analyze` summary — no server route, no UI. See "Surfacing it" below.

**Correction (2026-08-26):** an earlier revision claimed real-run data confirmed the
per-file source-duplication hypothesis this document opened with. It does not — see
"The duplication hypothesis, tested against real data" below. The measurable duplication
is prompt boilerplate, not file source.

## Goal

Per-call logging that answers three questions, in order of how soon they matter:

1. What is this analysis run actually costing (tokens, and $ for paid providers)?
2. Are we re-sending the same file's source multiple times across calls?
3. If so, is batching multiple units per file/cluster into one prompt worth the
   redesign?

Logging answers (1) and (2) cheaply. (3) is a real prompt/schema redesign and should
only be scoped after (2) shows the data is actually duplicated at a wasteful scale.

## What exists today

`ProviderResult` (`packages/interpreter/src/provider.ts`) returns `inputTokens` and
`outputTokens` alongside the legacy `tokens` field. Ollama reads both
`prompt_eval_count` and `eval_count`; Anthropic and Claude CLI read their usage blocks.
`CachedProvider` aggregates the directions for the current run and counts cache hits
without charging cached tokens.

## Proposed shape

Per-call record:

```
{ pass: "A" | "B" | "C", unit_id, qualname, file, in_tokens, out_tokens,
  cost_usd, cache_hit, ts }
```

`unit_id`/`qualname`/`file` are what make "did we hit this file twice" a query instead
of a guess.

### Capturing in/out tokens

Each provider needs updating to report both sides, not just one total:

- **Ollama**: `/api/generate` response already has `prompt_eval_count` (in) and
  `eval_count` (out) — read both.
- **Anthropic / Claude CLI**: check what their usage blocks return today; likely
  discarded the same way.

### Cost assignment

Only meaningful for paid providers. A small static `$/1K tokens` price table per model,
applied to in/out tokens, gives `cost_usd`. Local Ollama rows are `cost_usd: 0` /
`null` — tokens matter there for latency/throughput, not billing.

### Where it's stored — **shipped**

`.scv/cache.sqlite` (already the interpreter's local store), as a new table — not a
flat log file, so "group by file, count calls" is a one-line query. `CachedProvider`
(`packages/interpreter/src/cached-provider.ts`) is the natural interception point,
since every `interpret()` call already funnels through it. A cache hit should record
`cache_hit: true` with zero new tokens/cost — it didn't call the provider.

### Surfacing it

The shipped version prints a summary line at the end of `scv analyze` with total in/out
tokens, provider-call count, and cache hits, and persists per-call rows to `llm_calls`.
Beyond that summary, **nothing reads those rows** — the trace is queryable only by opening
`.scv/cache.sqlite` by hand.

#### The data stops at the CLI boundary

```
llm_calls (SQLite)  ->  listCalls()  ->  scv analyze summary (stdout)
                                      |
                                [ nothing ]
                                      |
                      server /api/*  ->  UI
```

`.scv/cache.sqlite` is a CLI-local store. The server reads only snapshots
(`packages/server/src/store.ts`); it never opens the cache DB, and there is no
usage-style route. The UI's `cost` fields (`Inspector.tsx:203-207`, `Flows.tsx:213`)
are `unit.cost` — the Interpreter's semantic complexity/IO estimate. That is a **name
collision, not LLM spend**; no UI surface shows tokens or cost.

#### Two shapes, not yet decided

The trace is per-run, per-machine and cache-local. It is not snapshot data, so it does
not belong to a rev the way units and edges do — which is exactly what makes surfacing
it a design question rather than plumbing:

- **CLI-only** — an `scv usage` command (or flags on `analyze`) that runs the queries
  and prints. Cheap, matches where the data lives, no schema or API change.
- **UI-surfaced** — requires deciding whether usage becomes snapshot-attached (survives
  with a rev, diffable across commits) or stays a live sidecar the server reads from the
  cache DB. The former is a schema change; the latter couples the server to a CLI-local
  store it currently knows nothing about.

Recommendation: **CLI-only first.** It answers the three questions this doc opened with
without committing to a persistence model. Surfacing spend per rev over time is worth its
own plan if it is wanted.

#### The duplication hypothesis, tested against real data — and corrected

**The original premise was wrong, and the data disproves it.** This document opened by
supposing that "Pass A sends one prompt per leaf unit — if several units share a file,
that file's source is re-sent once per unit". An earlier revision of this section claimed
a run against `../eq_to_word_problem` had *confirmed* that, on the strength of a
`count(*) GROUP BY file` query showing `auth_service.py` with 10 calls.

That query does not show what it was read to show. Grouping calls by file counts **units
per file**, which is expected and harmless on its own. The per-call token counts settle it:

| file | calls | min in_tokens | max in_tokens |
|---|---|---|---|
| `backend/services/eval_service.py` | 13 | 355 | 1363 |
| `backend/services/auth_service.py` | 10 | 337 | 645 |
| `backend/services/equation_validator.py` | 7 | 375 | 1207 |

Input size varies with each *function's* size, not with the file's. If the whole file were
embedded per call, every row for a given file would be large and roughly equal.

The code agrees: `passAPrompt` is handed
`readSource(symbolUnit.loc.file, symbolUnit.loc.start, symbolUnit.loc.end)`
(`orchestrate.ts`), which slices **that unit's span only** — never the enclosing file.

So there is no per-file source duplication to eliminate, and the batching redesign this
document floated as question (3) has no motivating evidence behind it. Do not reopen it
on the strength of a file-grouped call count alone.

#### What *is* duplicated: the prompt boilerplate

Measured on the same run (334 Pass A calls, 298562 input tokens, mean 894/call):

Every Pass A prompt ends with an identical ~250-token JSON response schema, and nearly
every one opens with the identical role sentence — `unit.kind` is `"function"` for the
overwhelming majority of units, so the framing is stable across long runs of consecutive
calls. That is on the order of **80K of the 298K input tokens (~30%) re-sent verbatim**,
and it sits at the *tail* of the prompt where no prefix cache can reach it.

This is the duplication worth chasing, and it is a prompt-ordering problem rather than a
batching one. Tracked in `docs/backlog/prompt-prefix-ordering.md`.

### Progress during the run, not just a summary after — **shipped**

(Implemented as `reportProgress` in `orchestrate.ts`; the design discussion below is kept for history.)

A full-repo analyze against a local model takes long enough (minutes, observed on this
repo's own ~500 units at `PASS_A_CONCURRENCY = 2`) that a silent CLI is a bad
experience — today `orchestrate.ts` only logs on a Pass A failure/skip, so a healthy
run prints nothing until the final "wrote .scv/snapshots/…" line. Wanted instead:
sequential progress as the run proceeds, not just a token/cost total at the end.

Minimal version, no new dependency: since Pass A now runs through
`mapWithConcurrency` (`orchestrate.ts`), thread a counter through that closes over
`snapshot.units.length` and print `pass A: N/total (qualname)` — or throttle to every
Kth unit — as each `fn(item)` resolves, not just on error. Same idea for Pass B
(cluster count) and Pass C (layer count), which are already small enough to log every
step. Piggybacks on the file/unit identity already being captured for the
duplication-detection work above, rather than adding a separate mechanism.

A real progress bar (`\r`-redraw, ETA from a rolling average) is a nice-to-have on top
of that once plain sequential logging exists — not worth building first.

## Orchestration/tracing frameworks: considered, deferred

Three frameworks come up whenever "monitor LLM calls" is the ask. None are adopted
here; reasoning for later reference:

- **LangGraph** (graph/state-machine orchestration over LLM calls). Pass A/B/C is
  already a plain linear pipeline (`orchestrate.ts`) with its own retry logic
  (`retry.ts`) — no branching, no agentic decisions, nothing LangGraph's node/edge
  model would buy over what's there. Reconsider only if a pass needs to make dynamic
  control-flow decisions (e.g. loop until confidence crosses a threshold, or choose
  between strategies) — not the case today.
- **LangSmith** (hosted tracing for LangChain/LangGraph). This is the piece that
  actually matches the observability goal (per-call trace, token/cost breakdown), and
  it's usable independent of LangGraph via its tracing SDK. Deferred because it's a
  third-party hosted service — data (prompts, responses) would leave the machine — and
  this project otherwise runs fully local against Ollama with no external services
  (CLAUDE.md: never write secrets, local-first posture). Would need an explicit
  opt-in/redaction story before adoption.
- **OpenTelemetry** (vendor-neutral tracing, self-hostable or backend-less). Fits this
  project's local-first posture much better than LangSmith, and composes with the
  sqlite-table approach above — OTel spans could carry the same attributes
  (`unit_id`, `file`, `in_tokens`, `out_tokens`, `cache_hit`) as transport, with sqlite
  as the durable store, or skip OTel entirely and query sqlite directly. Lowest-priority
  of the three: the sqlite table alone already answers the concrete questions (cost,
  file duplication) this doc opened with, without adding a dependency.

Net: the sqlite per-call log above is the load-bearing piece. These frameworks are
additive polish, not prerequisites — revisit only if the pipeline's control flow
actually grows agentic branches, or if tracing needs to be shared outside this machine.

## Bug this logging surfaced

Reading actual query/response text via `--log-level info` found that Pass B/C's
`oneLiners` input is broken — every file gets the literal fallback `"(no summary)"`,
every run. Root cause, blast radius, and fix are documented in
[`codebase-analysis.md` §3](codebase-analysis.md#3-clustering-and-architecture-grouping-pass-b--pass-c--new-grouping-step)
(the doc that already tracks Pass B/C's current-vs-intended input shape) rather than
here, since it's a phase-3 pipeline bug, not an observability gap.

## Open questions for whoever picks this up

- Does grouping by `file` across Pass A calls actually show meaningful duplication in
  practice, once real logging exists? Don't build batching speculatively — look at the
  data first.
- If batching is warranted: Pass A today is one-unit-in, one-semantics-out
  (`packages/interpreter/src/prompts/pass-a.ts`). Moving to many-units-in,
  many-semantics-out changes both the prompt and the response schema
  (`PassAResponseSchema`) — scope that as its own design pass, referencing whatever the
  logging data shows.

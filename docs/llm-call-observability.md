# LLM call observability

Token direction reporting is implemented for provider calls and `scv analyze` summaries.
The per-call SQLite trace and file-duplication analysis remain future work. This document
tracks both the shipped usage reporting and the follow-up design, prompted by two things
found while fixing layer semantics: Pass A/B/C calls have no visibility into token cost,
and Pass A sends one prompt per leaf unit — if several units share a file, that file's
source is re-sent once per unit with no way to currently detect it.

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

### Where it's stored

`.scv/cache.sqlite` (already the interpreter's local store), as a new table — not a
flat log file, so "group by file, count calls" is a one-line query. `CachedProvider`
(`packages/interpreter/src/cached-provider.ts`) is the natural interception point,
since every `interpret()` call already funnels through it. A cache hit should record
`cache_hit: true` with zero new tokens/cost — it didn't call the provider.

### Surfacing it

The shipped version prints a summary line at the end of `scv analyze` with total in/out
tokens, provider-call count, and cache hits. Persisting per-call rows (above) would still
be needed for file-duplication queries and cost trends across runs.

### Progress during the run, not just a summary after

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

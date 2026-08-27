# Prompt boilerplate sits at the tail, defeating prefix caching

**Status:** open
**Found:** 2026-08-26

## Problem
Every interpreter prompt follows the same shape (`packages/interpreter/src/prompts/`):

1. a one-line role sentence — "You are analyzing a single ${unit.kind} from a codebase…"
2. the per-call variables (unit, language, file, graph context, source)
3. an identical response-format schema, ~250 tokens, last

The invariant part is therefore **split around** the variable part, with the largest
invariant block at the very end. Prefix caching — llama.cpp/ollama slot reuse, or an
explicit `cache_control` breakpoint on a cloud provider — can only reuse a *leading*
common substring, so today it has almost nothing to work with: the shared prefix ends at
`${unit.kind}`.

Crucially, `unit.kind` is `"function"` for the overwhelming majority of Pass A units, so
the role sentence *is* stable across long runs of consecutive calls. The framing is not
the obstacle; the ordering is.

## Scale
Measured on `../eq_to_word_problem` (`llm_calls` table): 334 Pass A calls, 298562 input
tokens, mean 894 per call, min 241 / max 20365.

At ~250 tokens of schema per call, that is roughly **80K of 298K input tokens (~30%)
re-sent verbatim** every run, positioned where no cache can reach it. On a metered
provider that is ~30% of the input bill.

## Possible fix
Two variants, and the second is probably the right one:

- **Reorder** — put the response schema (and the role framing) before the per-call
  variables, so the stable text forms a real prefix.
- **Move the invariant text into `system`.** `ProviderContext.system` is already plumbed
  end to end (`cached-provider.ts:57`, `providers/ollama.ts:33`, `providers/anthropic.ts:43`)
  but **no caller ever sets it** — every prompt today is a single user message. The schema
  and role framing are exactly what a system prompt is for, and Anthropic caches system
  blocks with a breakpoint.

## Caveats to settle before building
- **Cache-key invalidation.** `CachedProvider` keys on prompt text, and passes `system`
  through separately (`cached-provider.ts:57`). Moving text from the prompt into `system`
  changes every key and invalidates all of `.scv/cache.sqlite`. That is a one-time cost,
  but `promptRev` should be bumped deliberately rather than discovered.
- **Anthropic's floor.** Prefix caching there is not automatic: it needs an explicit
  `cache_control` breakpoint, and the minimum cacheable prefix is 1024 tokens (2048 for
  Haiku). A ~250-token schema does **not** qualify on its own — reordering alone buys
  nothing there without also clearing the floor.
- **Slot contention on ollama.** llama.cpp holds one prefix per slot and matches against
  that slot's previous request. With `PASS_A_CONCURRENCY = 2` and Pass A interleaving with
  Pass A-blocks (a different prompt family), streams can evict each other. Reuse is likely
  but not guaranteed — measure, do not assume.
- **Decode dominance.** Mean call duration is ~25.7s for ~370 output tokens; these runs are
  generation-bound, so cutting prefill will not cut wall time proportionally. The token/cost
  saving is the solid win; a latency win is not.

## Related
- `docs/llm-call-observability.md` — the correction showing this, not per-file source
  duplication, is the real repetition in Pass A prompts.
- `llm-call-concurrency.md` — the slot-contention caveat above depends on that constant.
- `openai-provider.md` — a third provider with its own caching semantics to account for.

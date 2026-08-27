# Ollama provider never sets `num_ctx`

**Status:** open
**Found:** 2026-08-26

## Problem
`OllamaProvider.interpret` (`packages/interpreter/src/providers/ollama.ts:27-36`)
posts to `/api/generate` with only `model`, `prompt`, `system`, `stream`, and
`think`. There is no `options` block, so `num_ctx` is never set and the effective
context window is whatever the Ollama server and model happen to default to.

That makes the input context a property of the environment rather than of the code:
a different Ollama version, a set `OLLAMA_CONTEXT_LENGTH`, or a smaller model on
another machine changes it silently. Ollama **truncates** an over-long prompt rather
than erroring, and `prompt_eval_count` (already captured) reports the *post*-truncation
count — so a run can look healthy while quietly losing the front of the prompt.

`AnthropicProvider` sets `maxTokens` (`anthropic.ts:22`), but that is the *output*
cap — a different knob. No provider in the repo sets an input context length.

## Observed
Measured locally, ollama 0.33.0, `OLLAMA_CONTEXT_LENGTH` unset:

| | Value |
|---|---|
| `qwen3.5:9b-mlx` max context (`ollama show`) | 262144 (256K) |
| Context the loaded instance reported (`ollama ps`) | 131072 (128K) |
| Set by this codebase | nothing |

A bare `/api/generate` call with no `options` (the exact body shape the provider
sends) succeeded and left the reported context unchanged at 131072.

**Caveat:** an `scv analyze` run against `../eq_to_word_problem` was in flight at the
time, so 131072 reflects however *that* run's first load resolved. Whether a cold load
with no active session picks the same number is unverified — re-measure with nothing
running before treating 128K as "the server default".

## Why it is not urgent
At a 128K window, Pass A prompts (unit source + callers/callees) and Pass B/C prompts
(cluster + docs context) are nowhere near truncation on repos of the size analyzed so
far. The concern is silent environment-dependence, not a live defect.

## Possible fix
Thread an optional `numCtx` through `OllamaProviderOptions` and emit
`options: { num_ctx: N }` in the request body. Picking N is the real question, and it
is a genuine trade-off rather than "bigger is better":

- A large `num_ctx` reserves KV cache whether or not prompts use it — the loaded model
  grew 11 GB -> 12 GB across the measurement.
- Pinning it *lower* than the server default may reduce footprint for this workload,
  since these prompts are small relative to 128K.
- Any explicit value should be justified against measured `prompt_eval_count`
  distributions per pass, not guessed.

Related: per-call token capture already exists, and the per-call SQLite trace in
`docs/llm-call-observability.md` would make the prompt-size distribution queryable —
that data is the natural input to choosing N.

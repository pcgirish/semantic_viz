# OpenAI provider adapter

**Status:** open
**Found:** 2026-08-26

## Problem
`scv` ships three providers — ollama, anthropic, claude-cli
(`packages/interpreter/src/create-provider.ts`). OpenAI is not among them, despite
`docs/plans/original-architecture-pipeline.md` speccing it as one of three v1
adapters (it even names `src/enrichment/providers/openai.ts`). Documented intent
that never got built, not new scope.

## Why it is small
The abstraction is already right. `Provider`
(`packages/interpreter/src/provider.ts`) is three members — `name`, `model`,
`interpret` — there is a single factory, and `AnthropicProvider` is a near-exact
template: raw `fetch` with no SDK dependency, API key from env, usage block read
for in/out tokens.

## Touch points

| # | File | Change |
|---|---|---|
| 1 | `packages/interpreter/src/providers/openai.ts` | New. ~50 lines, mirroring `anthropic.ts` |
| 2 | `packages/interpreter/src/config.ts:12` | Add `"openai"` to the Zod enum |
| 3 | `packages/interpreter/src/create-provider.ts` | New `case` + `DEFAULT_OPENAI_MODEL` |
| 4 | `packages/cli/src/bin.ts:20` (and the `diff` twin at `:83`) | `--provider` help text |
| 5 | `packages/interpreter/test/openai-provider.test.ts`, `create-provider.test.ts` | Tests, patterned on the existing provider tests |

API differences, all contained in file 1: POST
`https://api.openai.com/v1/chat/completions`; `Authorization: Bearer $OPENAI_API_KEY`;
no `anthropic-version` header; system prompt goes in as a `{role:"system"}` message
rather than a top-level `system` field; response text at
`choices[0].message.content`; usage at `usage.prompt_tokens` /
`usage.completion_tokens` (vs Anthropic's `input_tokens`/`output_tokens`).

## Two decisions to make up front

- **JSON mode.** Every pass goes through `interpretJsonWithRetry`, so responses must
  parse as JSON. Today ollama and anthropic achieve that by prompt shape alone
  (neither sets a structured-output flag). OpenAI offers
  `response_format: { type: "json_object" }`, which would make it *more* reliable
  than the incumbents. The retry/validate path already handles malformed replies, so
  shipping without it works; adding it is roughly one line.
- **Reasoning models.** `gpt-5`-class models take `max_completion_tokens` rather than
  `max_tokens` and ignore `temperature`. Targeting a plain chat model sidesteps this
  entirely; supporting both needs a small branch on model name.

## Related
Per-provider concurrency defaults are worth settling alongside this — see
`llm-call-concurrency.md`, which notes the hardcoded `PASS_A_CONCURRENCY = 2` is
tuned for a local ollama and is the wrong ceiling for a rate-limited cloud API.
Cost-in-USD assignment (`docs/llm-call-observability.md`) also gains a second paid
provider to price.

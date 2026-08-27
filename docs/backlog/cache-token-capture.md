# Cache tokens are discarded before they reach `llm_calls`

**Status:** open
**Found:** 2026-08-26

## Problem
The Anthropic Messages API returns four usage fields —
`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, and
`cache_read_input_tokens`. The repo captures the first two and drops the other two
on the floor, at the earliest possible point: the response type in
`packages/interpreter/src/providers/anthropic.ts:50-53` declares only

```ts
usage: { input_tokens: number; output_tokens: number };
```

so the cache fields are narrowed away at the parse, before `ProviderResult`, before
`logCall`, before the table. They arrive on the wire and are never seen again.

This matters because the cache split is *where the cost is*. A cache-read input token
bills at a fraction of a fresh input token, so a run's `in_tokens` total is not
proportional to its spend. On the one provider in this repo that actually charges
money, the recorded numbers cannot be turned into a bill.

Ollama is unaffected in practice — `/api/generate` reports no cache fields, and local
inference is free — but the columns should be nullable rather than ollama-shaped, so a
metered provider can populate them without another migration.

## Where it is dropped
Five layers, all of which need widening:

| Layer | File | Current |
|---|---|---|
| Response type | `providers/anthropic.ts:50-53` | narrows `usage` to two fields |
| `ProviderResult` | `provider.ts:23-29` | `tokens`, `inputTokens?`, `outputTokens?` |
| `ProviderUsage` | `provider.ts:31-37` | run-level rollup, same two token fields |
| `logCall` record | `cache.ts:257-275` | inserts eight columns |
| `llm_calls` schema | `cache.ts:94-104` | `in_tokens`, `out_tokens`, `cache_hit`, `duration_ms` |

Note `cache_hit` already exists but means something different: it is *`CachedProvider`'s
own content cache* (a call that never reached the provider), not the provider-side
prompt cache. Both are worth recording; conflating them would make either number
useless. Name the new columns so the distinction survives — e.g.
`cache_read_tokens` / `cache_write_tokens` against the existing `cache_hit`.

## Why this is a prerequisite, not a nice-to-have
`docs/backlog/prompt-prefix-ordering.md` proposes restructuring prompts so a stable
prefix becomes cacheable. Its entire justification is a caching win. With today's
columns there is no way to measure whether it worked — a successful change and a
no-op look identical, because the only field that would move is the one not recorded.

**Land this first.** Otherwise the prompt-prefix work ships on an argument that cannot
be checked against a real run.

## Possible fix
1. Widen the Anthropic response type to read all four usage fields.
2. Add optional `cacheReadTokens` / `cacheWriteTokens` to `ProviderResult` and
   `ProviderUsage`; leave them undefined on ollama and claude-cli.
3. Add nullable `cache_read_tokens` / `cache_write_tokens` columns to `llm_calls`,
   following the existing `ALTER TABLE` guard used for `duration_ms`
   (`cache.ts:106-109`) so existing `.scv/cache.sqlite` files migrate in place.
4. Optionally a nullable `cost_usd`, left null unless the provider supplies or the
   caller configures a price — do **not** hardcode a price table as part of this item.

Optional/nullable throughout is deliberate: a provider that cannot report a field
should store null, which is a different claim from zero.

## Not in scope
Cross-provider cost *comparison*, and any UI or schema surface for these numbers.
See `docs/llm-call-observability.md` for why the recommendation is a CLI-only
`scv usage` before committing to either.

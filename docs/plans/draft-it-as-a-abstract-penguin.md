# Batch entity summarization in `summarizeEntities`

## Context

`summarizeEntities` (`src/llm/summarizer.ts:23`) currently issues one LLM call
per cache-miss entity (`Promise.all` over `entities.map(...)`, each call
seeing only that one entity's own files/symbols). On a cold cache — the very
first `scv analyze` run on a repo, or any `--full` rerun — every entity misses
at once, so a repo with N modules makes N fully independent round trips, with
no cross-module context and no reuse of file reads across entities that
happen to share files.

The fix: batch the *request* side — group multiple entities into one prompt,
ask the model to return a structured, per-entity-id response, Zod-validate it,
then fan the validated array back into today's existing per-entity cache
writes. Caching stays exactly as granular as it is today (per-entity
`contentHash`, unchanged `cacheKey`/`summarizableContent`); only how many
entities share one LLM call changes. For incremental reruns (the common case
— a handful of changed entities) batches will typically be small or size-1,
naturally degrading to today's behavior with no regression. The win is
concentrated exactly where it matters: first-run/full-rerun cold-cache
analysis, where batching also gives the model real cross-module context
(sibling modules in the same architectural domain, summarized together)
that today's fully-isolated per-entity calls cannot produce.

Decided with the user:
- Batch module-level entities by `SemanticEntity.domain` (falls back to
  containing directory when `domain` is undefined, e.g. `config`/`tests`
  modules — see `inferDomain`, `src/scanner/semanticEntity.ts:76-84`).
- Batch function-level (`function_group`) entities by containing directory
  (no `domain` concept exists for functions).
- Cap batch size by total file bytes so no single call blows the context
  window; a domain/directory whose combined content exceeds the cap splits
  into multiple batches.
- Fully replace `summarizeEntities`'s internals — no parallel
  `summarizeEntitiesBatched` path, no mode flag. One function, batched
  internally, matching this codebase's existing preference for separate
  functions over flags (e.g. `buildSemanticInventory` vs `analyzeRepo`) —
  here it's simpler still, since callers don't even need to choose.
- No third "architecture-level" summarization exists or is being added —
  confirmed `domain`-based Architecture View clustering reuses each module's
  existing summary; it's a batching *key*, not a new entity kind.

## Design

### 1. New types in `src/llm/provider.ts`

```ts
export type SummarizeBatchInput = {
  // One prompt covers all of these; batchKey is just for logging/step
  // messages (e.g. "summarize batch: domain=orders (3 entities)").
  batchKey: string;
  entities: SummarizeInput[]; // reuse existing per-entity shape, incl. fileContents
};

export type SummarizeBatchOutput = {
  summaries: { entityId: string; summary: string }[];
};
```

Add `summarizeBatch(input: SummarizeBatchInput): Promise<SummarizeBatchOutput>`
to the `Summarizer` interface (alongside `summarize`/`summarizeDelta`/
`summarizeGrouping`).

Add `batchSummaryPromptFor(input: SummarizeBatchInput): string` and
`parseSummarizeBatch(text: string, providerName: string): SummarizeBatchOutput`
in `provider.ts`, mirroring `groupSuggestionPromptFor`/`parseGroupSuggestion`
exactly (same file, same shared-between-both-backends rationale, same
`stripMarkdownFence` reuse for local-model markdown-fencing quirks):

```
Summarize the purpose of each of the following code modules in one or two sentences each.
Entities:
--- entity "src/orders/create_order" (label: "create_order") ---
Files: src/orders/create_order.py
Symbols: create_order, validate_order
Source:
--- src/orders/create_order.py ---
<content>
--- entity "src/orders/list_orders" (label: "list_orders") ---
...

Respond with ONLY a JSON object of the exact shape
{"summaries": [{"entityId": string, "summary": string}, ...]}, no other text.
Every entity id listed above must appear in exactly one summaries entry.
```

Validate the parsed shape with Zod (per CLAUDE.md's "Input validation via
Zod... never trust raw request data" — already the convention for
`parseGroupSuggestion`, which this project treats LLM output as untrusted
free text subject to the same rule as HTTP input). Reject/throw on: not valid
JSON, `summaries` not an array, any entry missing `entityId`/`summary` as
strings.

### 2. `src/llm/anthropicSummarizer.ts` / `ollamaSummarizer.ts`

Add `summarizeBatch` to each `createXSummarizer` return object, calling the
same `callAnthropic`/`callOllama` transport with
`batchSummaryPromptFor(input)`, then `parseSummarizeBatch(text, "Anthropic"|"Ollama")`.
No new transport code — reuses `connectAnthropic`/`connectOllama` and their
existing retry wrapping (`withRetry`) unchanged.

### 3. `src/llm/summarizer.ts` — rewrite `summarizeEntities`

Replace the current `Promise.all(entities.map(...))` body with:

1. **Split hits vs. misses** (unchanged logic): for each entity, compute
   `cacheKey` as today; if not `options.force` and `cache.get(key)` hits,
   resolve that entity immediately with the cached summary — no LLM
   involvement, no batching needed for this entity at all.
2. **Group the miss/stale entities into batches:**
   - Module-level: group by `entity.domain ?? containingDirectory(entity)`,
     where `containingDirectory` mirrors what `inferDomain` falls back to —
     effectively `entity.id`'s directory when no domain exists. (Function-
     level entities have no `domain` field, so they always use directory —
     no special-casing needed beyond "group by `entity.domain ?? dirname`".)
   - Within each domain/directory group, further split into sub-batches
     capped at a `MAX_BATCH_BYTES` constant (start at e.g. 40_000 chars of
     combined file content — tune later; document as a named constant, not
     a magic number) so one call never gets an unbounded prompt.
   - A batch of size 1 is valid and expected for incremental reruns —
     no special-case short-circuit back to `summarize()`; `summarizeBatch`
     with one entity works identically, just isn't the common cold-cache
     case. This keeps one code path instead of two.
3. **Read file contents once per unique file across a batch** (dedup by
   path) before building `SummarizeBatchInput.entities`, in case sibling
   entities in the same domain/directory ever share a file — avoids
   redundant `readFile` calls within a batch, though this is a minor
   secondary win vs. the main point (fewer LLM round trips).
4. **Call `provider.summarizeBatch(...)` per batch** (batches run
   concurrently via `Promise.all` across batches, same failure-isolation
   property the existing test at `summarizer.test.ts:93` requires — one
   batch failing must not lose cache writes already made by other
   successful batches; batches, not individual entities, are now the unit
   of `Promise.all`, but the mid-flight-failure contract is the same).
5. **Map response back to cache writes:** for each `{entityId, summary}` in
   the batch response, find the matching entity, `cache.set(key, summary,
   {contentHash, analyzedAt})` exactly as today (line 62 unchanged), and
   attach `{ ...entity, summary }` to the result array.
6. **Any entity id present in the input batch but missing from the
   response** must not be silently treated as summarized — per the Trust
   Policy ("unknown != safe"), leave that entity's `summary` as `""` (same
   as an unanalyzed cache-miss) rather than fabricating a placeholder, and
   do not write a cache entry for it. Surface this via the existing
   `onStep`/logging path if useful, but don't throw for a partial batch
   response — a partial success (8 of 10 entities returned) should still
   cache the 8 that came back correctly, not discard the whole batch.
7. Preserve final return order matching input `entities` order (existing
   callers may depend on this — verify against `pipeline.ts` call sites,
   neither of which appears order-sensitive today, but keep the contract).

### 4. `pipeline.ts` call sites — no changes needed

`analyzeRepo`'s two `summarizeEntities` calls (line 139 modules, line 161
function-level) keep their exact current signature and arguments — batching
is entirely internal to `summarizeEntities`. This is the payoff of doing the
grouping inside the existing function rather than adding a new one.

### 5. `src/llm/summaryCache.ts`, `cacheKey`, `summarizableContent` — no changes

Per-entity cache key derivation stays untouched; batching only changes how
many entities are requested together, never how they're cached.

## Files touched

- `src/llm/provider.ts` — new types, `batchSummaryPromptFor`,
  `parseSummarizeBatch`, `Summarizer.summarizeBatch` interface member.
- `src/llm/anthropicSummarizer.ts` — add `summarizeBatch`.
- `src/llm/ollamaSummarizer.ts` — add `summarizeBatch`.
- `src/llm/summarizer.ts` — rewrite `summarizeEntities` internals
  (batching + grouping logic); `readCachedSummaries` (the `scv serve`
  read-only path) is untouched — it never calls an LLM and has no batching
  concern.
- Tests (TDD — write these first, red before green, per CLAUDE.md):
  - `tests/summarizer.test.ts` — update/extend for batched behavior:
    same-domain entities issue one `summarizeBatch` call, not N `summarize`
    calls; cross-domain entities issue separate calls; a batch exceeding
    the byte cap splits into multiple calls; a partial-response batch
    (missing one entityId) still caches the entities that did come back;
    a batch-level failure still preserves other batches' cache writes
    (adapt the existing "still caches entities that succeeded" test,
    `summarizer.test.ts:93`, to fail at the batch level instead of the
    per-entity level).
  - `tests/helpers/fakeSummarizer.ts` — add a `summarizeBatch` fake
    (call-counting, same pattern as existing `summarize`/`summarizeGrouping`
    fakes) since this is shared across other test files
    (`createSummarizer.test.ts`, etc.) that construct a full `Summarizer`.
  - `tests/anthropicSummarizer.test.ts` / `tests/ollamaSummarizer.test.ts`
    — add cases for `summarizeBatch`: prompt shape, JSON-response parsing,
    markdown-fence stripping (Ollama), malformed-JSON error handling.
  - `tests/readCachedSummaries.test.ts` — no change expected (unaffected
    path); run to confirm.

## Verification

1. `npm run lint` and `npm test` — full suite green, including updated
   `summarizer.test.ts` batch-grouping cases.
2. Manual check with `--llm ollama` against a local model (per existing
   `ollamaSummarizer` test conventions) or a small fixture repo
   (`fixtures/orderly`): run `scv analyze` cold (`rm -rf
   .project-visualizer` first) and confirm via `--verbose` step output that
   entities sharing a domain are summarized in fewer LLM calls than there
   are entities, and that resulting summaries are still per-entity-correct
   (not cross-contaminated between siblings in the same batch).
3. Re-run `scv analyze` after editing one file in one module and confirm
   only that module's entity re-summarizes (incremental behavior
   unregressed) — this is the existing "calls the provider again when
   entity content changes" test's real-world equivalent
   (`summarizer.test.ts:70`).

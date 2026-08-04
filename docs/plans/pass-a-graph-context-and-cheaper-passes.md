# Analysis pipeline: cross-pass context + fewer/cheaper LLM passes

## Design intent

`scv analyze` runs Pass A (per-function) → B (clustering) → C (layer narration) → C-Groups → C-Flows,
and Pass D on diff. Passes already chain outputs (D reuses A/C's `what`/`why`; B/C combine static
edges with Pass A summaries) but two concrete defects break that chain, and Pass A never receives
graph context at all. Fix order: cheap deterministic fixes first, then static context, then ordering,
then tool-calling only if the data justifies it. Reject full per-pass agents: every pass fills one
fixed JSON schema from mostly-complete input — no open-ended task, no need for self-directed
planning — and agentic non-determinism breaks the content-addressed caching the whole pipeline's
cost model depends on. A capped tool-loop gets the same "ask for more if needed" capability without
that cost.

Convergence check: does one unit's analysis changing need to trigger re-analysis of others?
Within one run, no — callee's semantics don't depend on callers, so bottom-up ordering (callee
before caller) makes it a single topological pass, no fixed point. Across runs, yes: a changed
callee should invalidate its callers' cache entries. That's a cache-key fix, not a re-run loop.

## Defects found (verified against source)

- **Pass A gets no graph context.** `orchestrate.ts:62-83` calls `runPassA({unit, source})` only.
  `graph.edges` is in scope one line above, unused. `where`/`why` are guessed from source style.
- **`oneLiners` is always `"(no summary)"`.** `orchestrate.ts:144-156` groups units by
  `kind === "module"`, but Pass A (line 63) only writes `.semantics` onto function/class units.
  The lookup can never match. Pass B/C cluster and narrate on structure alone, silently.
- **Tokens are captured, never aggregated.** `cache.ts` stores a `tokens` int per call. Ollama only
  records output tokens (`eval_count`), discards input (`prompt_eval_count`). No file-duplication
  visibility, no cost visibility.
- **Pass A's `ports` output is parsed and dropped.** `pass-a.ts` parses `response.ports` but
  `PassAResult` never returns it. `Unit.signature` (exists in schema) stays empty forever.

## Plan

**1. Fix `oneLiners`.** Group by `LEAF_KINDS.has(unit.kind)` instead of `kind === "module"`.
Derive each file's one-liner from its leaf units' `.semantics.what`. Add regression test:
`oneLiners[file]` must not equal `"(no summary)"` once the file has a summarized unit.

**2. Static caller/callee context in Pass A prompt.** Extend `RunPassAOptions` with
`callers: string[]`, `callees: string[]` (qualnames). Precompute once from `graph.edges`
(`kind === "calls"`) before the Pass A loop — O(edges), not O(edges × units). Add a "Callers:" /
"Callees:" prompt section, rendered only when non-empty. Cap each list (e.g. top 8 + "+N more") to
bound token cost on high-fan-in units. Bump `promptRev`.

**3. Order Pass A bottom-up over the call graph.** Today Pass A processes `snapshot.units` in raw
array order via a 2-worker pool (`mapWithConcurrency`, `PASS_A_CONCURRENCY = 2`) — no dependency
awareness. Compute a reverse-topological order (DFS post-order over `calls` edges) so callees run
before callers. Break cycles by picking one entry unit per strongly-connected component,
declaration order for the rest — best-effort, not guaranteed. Keep the worker pool; feed it
dependency-ready units first instead of raw order. Once ordered, step 2's static callee list can
carry each callee's already-known `.semantics.what` inline — the common case, free, no extra call.
Test: mock chain `a→b→c`, assert processing order `c, b, a`; mock cycle `a→b→a`, assert it
completes.

**4. Cache-key fix for cross-run staleness.** If a callee's source changes, its cache entry
correctly misses — but a caller whose prompt embeds that callee's old one-liner still hits its own
stale cache entry. Fold a digest of each listed callee's `hash.semantic` (already computed,
`orchestrate.ts:81`) into Pass A's cache key (`cached-provider.ts:27`). Deterministic invalidation,
no re-run logic needed. Test: same unit, different callee-semantics digest → different cache key.

**5. Per-call LLM logging.** New table `llm_calls(pass, unit_id, qualname, file, in_tokens,
out_tokens, cache_hit, ts)` in `.scv/cache.sqlite`. Capture both token directions per provider
(Ollama: also read `prompt_eval_count`). Write one row per call from `cached-provider.ts` (the
single interception point); cache hits log zero new tokens. Print an end-of-run summary (tokens,
cost if paid provider, by pass). This is what settles whether step 7 is worth building — don't
guess.

**6. Stop dropping Pass A's `ports` output.** Superseded by
`review-reconciliation-security-and-correctness.md` step 4 — same fix, folded into that
plan's schema-validation PR since both touch `Unit.signature`. Add `signature` to
`PassAResult`, populate from `response.ports`. Set `unit.signature` in `orchestrate.ts`'s
Pass A result mapping. Zero new tokens — this data is already generated and paid for.

**7. Bounded tool-calling (build only if step 5's data justifies it).** Gives Pass A on-demand
lookup beyond the static list: `getSource(qualname)`, `getCallers`/`getCallees` (uncapped),
`getSiblings(qualname)`, `getOneLiner(qualname)` (returns a "not yet interpreted" sentinel, never
blocks or triggers a nested LLM call), `queryGraph` (documented as combining the above — not a
real NL engine). Requires: `Provider.interpret()` gains an optional `tools` param and a
discriminated result (`text` vs `tool_calls`) across all three providers; a capped loop driver
(3 rounds, then fail closed to static-only answer); whole-conversation caching (hash prompt + tool
calls + args together, so a cache hit skips the entire loop). Real new infrastructure — most of
its value is subsumed by step 3 making the common case (callee one-liners) free already. Scope
this only after step 5 shows step 3 isn't enough.

**8. Conditional: batch Pass A per file.** Only if step 5 shows real file-level duplication
(multiple units per file, same source resent per unit). Redesign `pass-a.ts` from
one-unit-in/one-out to many-units-in/many-out per file — new prompt, new response schema. Don't
start speculatively.

## Verification

- `npm run lint && npm test` after each step.
- Step 1: `scv analyze --log-level info`, confirm no `"(no summary)"` in Pass B/C prompts.
- Step 2: confirm Callers:/Callees: appear in logged Pass A prompts.
- Step 3: confirm call order via the ordering test; confirm callee one-liners appear inline.
- Step 5: confirm summary line prints; run `GROUP BY file` on `llm_calls` for the duplication
  number that decides step 8.
- TDD throughout, per CLAUDE.md: failing test before implementation, each step.

## Out of scope

- Pass C-Groups: already shipped, already combines layer semantics + rolled-up edge weights.
- Pass D: already reuses Pass A/C's `what`/`why` and blast radius; inherits step 1–3 improvements
  automatically, no changes needed.
- Full per-pass agents: rejected — see Design intent.

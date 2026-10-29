# Unconditional artifact rewrites invalidate downstream work that nothing re-blesses

**Status:** resolved 2026-10-29 by Phase 0 of `docs/plans/publishable-committed-semantics.md`:
artifact writes now go through write-if-changed (`writeArtifact` in `packages/cli/src/artifacts.ts`),
skipping when the stored `inputHash`, canonical `contentHash` and `partial` flag all match
**Found:** 2026-08-27 (investigating lost API-flow data in `../eq_to_word_problem` after an agent-based cluster run)
**Filed here:** 2026-08-27

## Symptom
`../eq_to_word_problem` had 14 narrated API flows. After running the agent-based
layers/groups analysis, the UI showed none. `flows.json` was never deleted or
emptied — it is still on disk, still 25KB, still holding all 14 flows. It was
being **silently discarded at snapshot-assembly time** because its recorded input
hash no longer matched a freshly computed one, and `assembleSnapshotFromCache`
substitutes `emptyArtifactDefault` (`artifacts.ts:477`) for a stale artifact
without saying so.

Nothing in the run re-analyzed anything. The mtimes in
`.scv/artifacts/c5ee733e.../`:

| Artifact | Written | Re-analyzed? |
|---|---|---|
| `extraction.json` | Aug 27 09:25:44 | no — identical graph, same commit |
| `clusters.json` | Aug 27 09:26:29 | yes (deterministic, no LLM) |
| `layers.json` | Aug 27 09:26:29 | narration merged from pending |
| `functions.json` | Aug 27 09:26:33 | **no** — 1.2MB rewritten unchanged |
| `groups.json` | Aug 27 09:26:33 | narration merged from pending |
| `docs.json` | Aug 26 23:19:26 | untouched |
| `flows.json` | Aug 26 23:18:48 | untouched — and the casualty |

Corroboration that no analysis re-ran: zero `llm_calls` rows in the 09:25–09:26
window (all 371 calls are from the earlier ollama session, 02:05–03:22Z); every
`functions.json` semantics entry still carries
`{"source":"llm","pass":"A","provider":"ollama","model":"qwen3.5:9b-mlx"}`
provenance from that session; newest source file in the repo is Jun 10 and the
artifact directory is named for the current HEAD (`c5ee733`), so both runs
analyzed the same tree.

## Cause

### 1. `merge-semantics` rewrites `functions.json` unconditionally
`merge-semantics.ts:390-391`:

```ts
const functionsInputHash = await computeInputHash("functions", ctx, {});
writeArtifact(ctx, "functions", functionsInputHash, functionsData);
```

No comparison against the stored hash, no check that `functionsData` actually
changed. It runs whether or not the merge touched a single function — and in this
run it did not.

That would still be harmless if the hash were stable. It is not:
`computeInputHash("functions", ...)` (`artifacts.ts:222-224`) is
`hashOf(graphHash(ctx.graph), ctx.promptRev, ctx.scopeKey ?? "all")` — it folds
in `promptRev` and `scopeKey`, which can shift between invocations for reasons
having nothing to do with the artifact's contents. So an unchanged artifact gets
republished under a moved hash, and everything keyed on it goes stale.

### 2. The post-merge re-bless list omits `flows`
`merge-semantics.ts:586` names the affected consumers in its own comment:

```ts
// computeInputHash reads only `functions.units` for clusters/layers/flows — the block fields
// are structurally required by FunctionsData but never hashed, so they stay empty here.
```

The code below it then re-blesses `clusters` (`:587-592`) and `layers`
(`:594-598`), and `docs` earlier at `:581-582`. **`flows` is named in the comment
and absent from the code.** `flows` depends on `["functions", "extraction"]`
(`artifacts.ts:47`), so it is invalidated by exactly the rewrite above, and it is
the one artifact left holding a stale hash.

### 3. Staleness is silent
`noLlmFallback` (`artifacts.ts:562`) has stale-recovery for `functions` only:

```ts
if (name !== "functions") return emptyArtifactDefault(name, ctx);
```

Every other artifact degrades to empty with no warning. A user sees a populated
`.scv` directory and an empty UI panel, with nothing connecting the two. Contrast
the docs path at `:581-584`, which caches an empty artifact but *warns* — that is
the right instinct, applied in only one place.

## Fix directions

**Write-if-changed (addresses the root cause).** `writeArtifact` should no-op
when the computed hash and payload both match what is already stored. This kills
the whole class: no spurious rewrite, no spurious invalidation, no re-bless list
to keep in sync. Cheapest correct fix and the one to prefer.

**Complete the re-bless list (narrow, immediate).** Add `flows` alongside
`clusters`/`layers`. Fixes this instance but leaves the pattern — the next
artifact added to the graph has to remember to appear in this list, which is how
`flows` was missed.

**Derive the list instead of hand-writing it.** `ARTIFACT_DEPS` already encodes
that `flows` depends on `functions`; the re-bless set could be computed as the
transitive dependents of whatever was rewritten, rather than enumerated by hand.
Removes the drift permanently.

**Warn on stale-to-empty substitution.** Independent of the above and worth doing
regardless: `emptyArtifactDefault` silently replacing real cached work is what
turned a hash bug into a mystery. It should warn, naming the artifact and the
hash mismatch.

## Also worth checking
- Whether `extraction.json`'s 09:25:44 rewrite was likewise a no-op write of an
  identical graph. `extraction`'s hash is `graphHash(ctx.graph)` alone
  (`artifacts.ts:220-221`) with no `promptRev`, so an identical tree should hash
  identically and the rewrite should be harmless — but it is the same
  unconditional-write pattern and confirms the scope.
- `ctx.graph` is built on every invocation regardless of cache state
  (`computeArtifact` for `extraction` is just `return { data: ctx.graph }`,
  `artifacts.ts:284-285`). The cache spares the LLM passes, never the parse.
  Probably fine — the parse is cheap — but it means "extraction was skipped" is
  never true, which made this harder to reason about.

## Recovery for an already-broken cache
`flows.json` content is intact — all 14 flows, narrated, with provenance. Only
its recorded `inputHash` is stale. So the recovery is a **re-bless, not a
re-author**: rewrite the existing payload under a freshly computed hash.

Do not re-run the analysis to fix this. Re-running an `agent-analyze-*` skill
would re-derive narration that is already on disk, which is wasted work for a
bookkeeping error — and it hides the bug by making the symptom go away without
correcting the hash accounting that caused it. Fixing the re-bless path (above)
restores the panel and prevents the next occurrence in one change.

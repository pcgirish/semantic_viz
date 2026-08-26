# Resumable Pass A: per-unit flush + `--scope` for `scv analyze`

## Context

A long `scv analyze` run against `../eq_to_word_problem` was interrupted and
restarted. The second run re-analyzed every unit the first run had already
completed — **zero cache hits across runs**, 349s of 1901s (18%) burned redoing
finished work.

Measured from `../eq_to_word_problem/.scv/cache.sqlite` (`llm_calls` table):

```
11:59:33  hit=0  37344ms  backend.config.Settings.validate_required   <- run 1
12:06:50  hit=0  18332ms  backend.config.Settings.validate_required   <- run 2, MISS
12:00:09  hit=0  74020ms  backend.config.Settings
12:07:02  hit=0  30718ms  backend.config.Settings                     <- MISS
```

58 Pass A calls, 42 distinct units, 14 re-analyzed. The only 2 cache hits are
degenerate — the same unit hit twice milliseconds apart *within* one run.

### Root cause: a circular dependency between the cache key and the artifact write

Pass A's cache key folds in `calleeSemanticsDigest` — a digest of the callees'
`hash.semantic` values (`orchestrate.ts:256-260`), passed as `cacheKeyExtra`
(`pass-a.ts:80-84`, hashed at `cached-provider.ts:38-41`). That digest is read
from `passAResultById` (this run's in-memory results), falling back to
`snapshotUnitById`.

On a resumed run `passAResultById` starts empty, and the structural snapshot has
`semantics: null` / `hash.semantic: null` for every unit (`snapshot.ts:23,33`) —
because the interrupted run **never wrote `functions.json`**. `ensureArtifact`
computes the entire pass, then writes once (`artifacts.ts:441-442`). So every
callee's contribution to the digest differs from run 1, every key changes, and
every lookup misses.

The per-unit results *are* durably cached (`cache.set` per call at
`cached-provider.ts:57`, SQLite WAL + `synchronous=FULL`) — they are simply
**unreachable**, because the key depends on state only persisted at the very end
of the pass. The cache is self-consistent only within one completed run.

### Second defect: poisoned cache entries

`interpretJsonWithRetry` (`retry.ts:28-36`) retries the full round-trip on a
parse/validation failure, but `CachedProvider.interpret` caches the response
*before* it is ever validated (`cached-provider.ts:57`). A malformed response is
written to cache under a deterministic key, so the retry — and every future run —
re-reads the same bad text. That unit fails permanently.

Confirmed in the live cache: **1 of 56 rows is unparseable as JSON.**

### Intended outcome

1. An interrupted `scv analyze` keeps every completed unit's work; resuming
   re-analyzes only what is genuinely unfinished.
2. A partial run still produces a valid snapshot — later phases (clusters,
   layers, groups, flows) proceed over whatever semantics exist, so an
   interrupted analysis still yields a usable visualization.
3. `scv analyze --scope` lets a large repo be analyzed in deliberate slices.
4. A bad LLM response is never cached, so a retry can actually succeed.

## Approach

### 1. Per-unit result store (the core fix)

Add a per-unit store written as each unit completes, so the callee digest
reproduces exactly across runs.

**Storage:** a new `pass_a_units` table in the existing `ContentCache` SQLite DB
(`packages/interpreter/src/cache.ts`) — not one file per unit. It reuses the DB
already open for the whole run, inherits WAL + `synchronous=FULL` durability,
and avoids thousands of small files in `.scv/`. Follow the existing
`CREATE TABLE IF NOT EXISTS` + `PRAGMA table_info` migration pattern already used
for `llm_calls` (`cache.ts:53-70`).

```sql
CREATE TABLE IF NOT EXISTS pass_a_units (
  sha         TEXT NOT NULL,
  unit_id     TEXT NOT NULL,
  struct_hash TEXT NOT NULL,   -- unit.hash.struct: invalidates when code changes
  prompt_rev  TEXT NOT NULL,
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  result_json TEXT NOT NULL,   -- the Unit written into passAResultById
  status      TEXT NOT NULL,   -- 'ok' | 'failed'
  ts          TEXT NOT NULL,
  PRIMARY KEY (sha, unit_id, struct_hash, prompt_rev, provider, model)
);
```

Methods on `ContentCache`, mirroring the existing `get`/`set`/`logCall` shape:

```ts
type PassAUnitRecord = { unit: Unit; status: "ok" | "failed" };

getPassAUnits(
  key: { sha: string; promptRev: string; provider: string; model: string },
  structHashByUnitId: Map<string, string>,   // current hashes — required
): Map<string, PassAUnitRecord>;

setPassAUnit(key, record: PassAUnitRecord & { unitId: string; structHash: string }): void;
```

`struct_hash` is part of the primary key, so a unit edited across runs
accumulates one row per version. The lookup **must** therefore be given the
current hashes and match on `(unit_id, struct_hash)` together — selecting on
`(sha, promptRev, provider, model)` alone can return several rows for one unit
and makes `Map<unitId, …>` construction ambiguous (last-write-wins on a stale
row would silently resurrect semantics for code that has since changed).
Implement as a query with the current hashes bound (chunked `IN` over
`(unit_id, struct_hash)` pairs), so a stale row is simply never selected.

**`result_json` is untrusted on read.** It is text in a file on disk, so a
truncated write, a partial WAL recovery, or manual tampering can leave a row that
is not a valid `Unit`. `getPassAUnits` must `JSON.parse` inside a `try` and
validate against the existing Zod `Unit` schema from `@scv/schema` — never cast.
A row that fails either step is deleted and simply omitted from the returned map,
which makes the unit look unanalyzed and therefore retryable on this same run.
This mirrors the read-side validation in section 4: the same reasoning applies to
both persisted stores, and the repo rule is that nothing external is trusted
without schema validation.

**Wiring in `runFunctionsPass`** (`orchestrate.ts:208-294`):

- Add `priorResults?: Map<string, PassAUnitRecord>` and
  `onUnitComplete?: (id, unit, status) => void` to `RunFunctionsPassOptions`
  (`orchestrate.ts:188-195`). The value carries `status`, not a bare `Unit` — the
  skip rule below is conditioned on it, so a `Map<string, Unit>` could not express
  the distinction. Keep `ContentCache` out of the interpreter package — the CLI
  owns persistence and passes these in, preserving current layering.
- Seed `passAResultById` from `priorResults`, **`ok` entries only**. A `failed`
  record must not seed the digest map: its unit carries no semantics, so seeding
  it would be indistinguishable from the structural fallback while wrongly
  suppressing the retry.
- Seed `knownOneLiners` from those same `ok` records. This map is **separate**
  from `passAResultById` (`orchestrate.ts:236`), keyed by `qualname` rather than
  unit id, and populated only on the success path (`orchestrate.ts:282`) — so
  seeding the digest map alone leaves it empty on a resumed run. It feeds
  `knownCalleeOneLiners` in the caller's prompt (`orchestrate.ts:271`), so an
  empty map changes the prompt text, which changes the provider cache key: the
  caller misses the entry run 1 wrote and may come back with different
  semantics. Seed `qualname → semantics.what` for every `ok` record with a
  non-empty `what`, taking `qualname` from the record's stored unit.
- Skip the `runPassA` call for any id whose record is `status: 'ok'`,
  incrementing progress so the `N/total` counter stays honest. A `failed` record
  is re-attempted.
- Call `onUnitComplete` immediately after each unit resolves — in **both** the
  success path (`orchestrate.ts:283-291`) and the failure path
  (`orchestrate.ts:274-280`), recording `status: 'failed'` for the latter so a
  failure is retried next run rather than frozen in.

`topoOrder` is deterministic (`topo-order.ts:13-37`), so processing order is
stable across runs and seeded results line up.

Because `passAResultById` and `knownOneLiners` are both pre-seeded,
`calleeSemanticsDigest` reproduces run 1's value and the caller prompt
reproduces run 1's text, so the content-addressed key matches and the existing
`ContentCache` hit path does the rest. **Callee-invalidation semantics are
preserved** — a callee whose semantics genuinely change still produces a
different digest and correctly re-analyzes its callers.

Include `struct_hash` in the key so an edited function invalidates its own stored
result independently of the cache row.

### 2. Incremental `functions.json` flush

So an interrupted run leaves a readable artifact, not just DB rows.

In `computeArtifact`'s `functions` branch (`artifacts.ts:210-212`), pass an
`onUnitComplete` that periodically writes the in-progress `functions.json` via
the existing `writeArtifact` (`artifacts.ts:137-141`), marked partial:

```json
{ "inputHash": "...", "partial": true, "data": { ... } }
```

- **Make `writeArtifact` itself atomic** (`artifacts.ts:137-141`) — write to a
  sibling temp file, then `renameSync` over the target. It calls `writeFileSync`
  directly today, which is not atomic. Fixing it at the flush call site only
  would leave the *final* pass-end write — and every other artifact's write —
  able to truncate `functions.json` on a kill, destroying the usable partial
  artifact this section exists to preserve. One change covers partial and final
  writes alike.
- Debounce — flush every N units (~10) and once at pass end, not per unit; the
  artifact is large and the cost is a full re-serialize.
- **`partial: true` must never be treated as fresh.** In `ensureArtifact`
  (`artifacts.ts:429-439`), a stored artifact with `partial: true` fails the
  freshness check and recomputes — with the per-unit store making that
  recompute nearly free. Only the write that happens *after Pass A runs to
  completion* omits the flag (see below).
- Under `--no-llm`, a partial artifact is *usable* but **not authoritative**.
  Debouncing means up to N-1 units can be complete in `pass_a_units` yet missing
  from the last flushed `functions.json`; preferring the artifact alone would
  silently drop their semantics. So the no-LLM path **merges**: start from the
  partial artifact (or `emptyArtifactDefault`, `artifacts.ts:322-348`, when there
  is none), then overlay every current-hash `ok` record from `getPassAUnits`,
  which is the durable record of completed work. The DB is the source of truth;
  the artifact is a cache of it. This is what delivers "interrupt anywhere, still
  get a valid visualization" — downstream passes already tolerate units with
  `semantics: null`, since that is exactly what the empty default feeds them
  today.

  The alternative — flushing per unit so the artifact is always current — was
  rejected: it re-serializes the whole artifact on every unit, and the merge
  costs one indexed query.

### 3. `--scope` on `scv analyze`

Add `--scope <entries...>` to the `analyze` command (`bin.ts:15-54`), matching
the flag that already exists on `merge-semantics` (`bin.ts:74-77`).

- **Reuse, do not reimplement**: export `inScope` and `globToRegExp` from
  `merge-semantics.ts:105-132` (currently module-private) so both commands share
  one vocabulary: `all` | `changed` | unit-id globs.
- **The matcher stays in the CLI; the interpreter never imports it.**
  `@scv/cli` depends on `@scv/interpreter` (`packages/cli/package.json:21`), not
  the reverse, so `orchestrate.ts` importing from `merge-semantics.ts` would
  invert the dependency. `changed` also shells out to git via `changedFiles(root)`
  (`merge-semantics.ts:24,127`), and `RunFunctionsPassOptions`
  (`orchestrate.ts:188-195`) carries no repo root — git access does not belong in
  the interpreter regardless.

  So the **CLI resolves scope to a concrete id set** and passes that down:
  `scopedLeafIds?: ReadonlySet<string>` on `RunFunctionsPassOptions`. The CLI has
  the snapshot, the root, and the matcher; the interpreter just intersects. This
  keeps `--scope` vocabulary in one place, keeps git out of the interpreter, and
  leaves the layering as-is. (Moving the matcher down into `@scv/schema` was the
  alternative — rejected: it would drag `changedFiles` and git along with it.)
- **Globs match the full `unit.id`, which carries a `u:` prefix** — verified
  against the repro cache: `u:backend.services.auth_service.get_user_from_token`.
  `globToRegExp` anchors with `^…$`, so `backend.services.**` matches *nothing*;
  the correct form is `u:backend.services.**`. Document this in the `--scope`
  help text on both commands and use prefixed examples throughout, since the
  failure mode is a silent no-op run rather than an error.
- Thread `scope?: string[]` through `RunAnalyzeOptions` (`analyze.ts:22-41`) →
  `ArtifactContext` (`artifacts.ts:100-121`), resolving it to `scopedLeafIds`
  before the `runFunctionsPass` call.
- Intersect with `leafIds` (`orchestrate.ts:232`) after the existing
  `LEAF_KINDS` / `isTestUnit` filters. Out-of-scope units keep prior results
  from the per-unit store when present, else stay structural.
- Scoping narrows *analysis*, never the snapshot: all units remain present, so
  the output stays a valid `scv/1` document.
- Fold the scope into the `functions` input hash (`artifacts.ts:151-152`) —
  otherwise a scoped run's artifact looks fresh to a later unscoped run and
  suppresses the remaining work.
- **Freshness is decided by pass outcome, never by the scope value.** An artifact
  is written without `partial` only when **all three** hold: Pass A reached every
  in-scope leaf, **zero units ended `failed`**, and the scope was `all`/omitted.

  The zero-failures clause matters because Pass A catches per-unit errors and
  continues (`orchestrate.ts:274-280`) — a run can therefore *attempt* everything
  and still finish with failures. Without the clause such a run looks complete,
  writes an unflagged artifact, and the next run treats it as fresh and never
  retries the failed units, freezing the failure in permanently. That is the exact
  defect section 1's `status: 'failed'` record exists to prevent, so freshness
  must respect it too.

  Implement by having `runFunctionsPass` return `{ attemptedAll, failedCount }`,
  and writing the unflagged artifact only on
  `attemptedAll && failedCount === 0 && scopeIsAll`. A run with failures stays
  `partial`, so the next run recomputes and retries them — cheaply, since every
  `ok` unit is served from the per-unit store.

### 4. Never cache an unvalidated response

Move caching behind validation so a retry can succeed. Validation must gate
**both** ends — the write *and* the read:

- Add an opt-in `validate?: (text: string) => boolean` to `ProviderContext`
  (`provider.ts`). Default unchanged when absent, so only Pass A's JSON path is
  affected.
- **On write**: `CachedProvider.interpret` skips `cache.set`
  (`cached-provider.ts:58`) when `validate` returns false.
- **On read**: the hit path returns the stored row unconditionally today
  (`cached-provider.ts:42-47`). Run `validate` against `cached.text` before
  returning it; on failure, `cache.delete(key)`, count it as a miss (not a
  `cacheHits` increment, and `cacheHit: false` in `logCall`), and fall through to
  the provider. Without this, a row poisoned by an earlier run is served forever
  and no amount of retrying can dislodge it — write-side gating alone fixes only
  caches that do not yet contain a bad row.
- Add `delete(key)` to `ContentCache` alongside `get`/`set`.
- `interpretJsonWithRetry` (`retry.ts:22-39`) supplies `validate`, reusing the
  `parseJsonResponse` + `schema.parse` it already runs — so validation means
  **parses as JSON *and* satisfies the Zod schema**, not merely parseable.
- Add a **genuinely one-shot** cleanup that deletes unparseable rows, so existing
  poisoned entries (1 confirmed in the live cache) are not permanent. The
  `ContentCache` constructor runs on every `scv` invocation (`cache.ts:29-69`), so
  an unguarded sweep would `JSON.parse` every row of a growing cache on every
  command. Guard it with a durable marker — a `meta(key, value)` table with a
  `cleanup_rev` row, checked and set in the same transaction as the sweep,
  following the existing `PRAGMA table_info` migration style. Later cleanups bump
  the rev.
- This sweep only catches malformed JSON; the read-side check above is what
  catches schema-invalid rows, which the sweep cannot identify without knowing
  each row's schema. The sweep is therefore a one-time tidy of existing damage,
  not the mechanism — if it were dropped entirely, the read path would still
  recover every poisoned row on next access.

## Files

| File | Change |
|---|---|
| `packages/interpreter/src/cache.ts` | `pass_a_units` table + `getPassAUnits` (current-hash matched, schema-validated, drops corrupt rows)/`setPassAUnit`; `delete(key)`; `meta` table + marker-guarded one-shot poisoned-row cleanup |
| `packages/interpreter/src/orchestrate.ts` | Seed `passAResultById` and `knownOneLiners` from `ok` records only; `onUnitComplete` on both paths; intersect `leafIds` with `scopedLeafIds`; return `{ attemptedAll, failedCount }` |
| `packages/interpreter/src/cached-provider.ts` | Skip `cache.set` when `validate` fails; validate on the hit path, deleting and re-fetching a bad row |
| `packages/interpreter/src/retry.ts` | Pass `validate` through (JSON parse + schema) |
| `packages/interpreter/src/provider.ts` | `validate?` on `ProviderContext` |
| `packages/cli/src/artifacts.ts` | Atomic `writeArtifact` (temp + rename); debounced partial flush; `partial` never fresh; unflagged write only on `attemptedAll && failedCount === 0 && scopeIsAll`; scope in input hash; merge `pass_a_units` over the partial artifact on the no-LLM path |
| `packages/cli/src/analyze.ts` | Thread `scope`; resolve it to `scopedLeafIds`; load prior results; wire `onUnitComplete` |
| `packages/cli/src/merge-semantics.ts` | Export `inScope`/`globToRegExp` (stays CLI-side — the interpreter receives resolved ids, not the matcher) |
| `packages/cli/src/bin.ts` | `--scope` on `analyze`; `u:`-prefixed examples in both commands' help text |

Tests follow the existing `fakeProvider()` pattern in
`packages/cli/test/artifacts.test.ts:28-57` and `analyze.test.ts:29-55` (each
suite defines its own; no shared helper exists).

## Implementation order

Bottom-up: `@scv/interpreter` (store → provider → Pass A) before `@scv/cli`
(artifacts → scope), matching the dependency direction. Each step lands its
gating tests **failing first**, then makes them pass; test numbers refer to
Verification below.

| # | Step | Files | Gated by |
|---|---|---|---|
| 1 | `pass_a_units` schema, migration marker, `getPassAUnits`/`setPassAUnit` keyed on the current `struct_hash`, Zod-checked `result_json` reads, marker-guarded poisoned-row sweep. Defines the `PassAUnitRecord` type the later steps consume. | `interpreter/src/cache.ts` | 9, 14, 15 |
| 2 | `validate?` on `ProviderContext`; `CachedProvider` gating both `cache.set` and the hit path; `ContentCache.delete`; `interpretJsonWithRetry` supplying the validator. | `interpreter/src/{provider,cached-provider,retry,cache}.ts` | 12, 13 |
| 3 | Pass A resume *contract*: `priorResults`/`onUnitComplete`/`scopedLeafIds` options, seeding `passAResultById` and `knownOneLiners` from `ok` records, skip rule, failure recording, `{ attemptedAll, failedCount }` return. Unit-tested by calling `runFunctionsPass` directly with hand-built maps — no persistence yet. | `interpreter/src/orchestrate.ts` | 7 |
| 4 | CLI persistence lifecycle: open the `ContentCache`, build `structHashByUnitId` from the snapshot, load current-hash records into `priorResults`, and supply an `onUnitComplete` that calls `setPassAUnit` per result and accumulates the in-progress unit map for step 5's flush. This is the step that makes resume actually work end to end. | `cli/src/analyze.ts`, `cli/src/artifacts.ts` (`functions` branch) | 1, 2, 6, 10 |
| 5 | Atomic `writeArtifact`, debounced partial flush over step 4's in-progress map, `partial` never fresh, the no-LLM merge of `pass_a_units` over the partial artifact. | `cli/src/artifacts.ts` | 3, 4, 5, 8, 16 |
| 6 | CLI `--scope`: exported matcher, resolution to `scopedLeafIds`, scope in the input hash, the `attemptedAll && failedCount === 0 && scopeIsAll` freshness rule, help text. | `cli/src/{bin,analyze,merge-semantics,artifacts}.ts` | 11 |
| 7 | Full `npm test` + `npm run lint`, then the end-to-end interrupt/resume check against `../eq_to_word_problem`. | — | — |

Steps 1–3 are self-contained in the interpreter and reviewable as one commit;
step 3 ships the contract but changes no observable behaviour until step 4 wires
persistence to it, which is why the resume tests (1, 2) gate step 4 rather than
step 3. Step 5 depends on step 4's in-progress map and step 3's return value;
step 6 depends on step 5's freshness rule. One branch, a commit per step — the
steps are too coupled to land as independent PRs.

## Verification

Per the repo's TDD rule, each item gets a failing test first.

**Automated** (`npm test`, `npm run lint`):
1. *Resume* — run Pass A over a fixture with a provider that throws after N
   units; re-run with a call-counting provider; assert the first N units make
   **zero** provider calls and the final snapshot is identical to an
   uninterrupted run.
2. *Restored callee one-liners* — a caller in scope whose callee is restored
   from `pass_a_units` (not processed this run) must produce the **same prompt**
   as an uninterrupted run: assert the caller hits the provider cache
   (`cacheHit: true`), and that with `knownOneLiners` left unseeded the same case
   misses — pinning the regression rather than only the fix.
3. *Partial artifact* — after an interrupted run, assert `functions.json` exists
   with `partial: true`, and that `scv analyze --no-llm` assembles a
   schema-valid snapshot carrying the completed units' semantics.
4. *Interrupt between debounce flushes* — kill after a flush plus a few more
   completed units (e.g. N=10, interrupt at 13). Assert the no-LLM snapshot
   carries **all 13**, not the 10 in the artifact — proving the merge reads
   `pass_a_units` rather than trusting the stale artifact.
5. *Interrupted `all` run stays partial* — an unscoped run killed mid-pass
   writes `partial: true`; a following unscoped run recomputes and completes the
   remaining units instead of treating the artifact as fresh.
6. *Invalidation* — changing a callee's source still re-analyzes its callers
   (digest semantics preserved); changing a unit's own source invalidates only it.
   Full-run level; the underlying stale-`struct_hash` lookup is covered at cache
   level by test 14.
7. *Failed record retried* — driving `runFunctionsPass` directly: a unit whose
   provider call throws is reported via `onUnitComplete` with `status: 'failed'`,
   a `failed` entry in `priorResults` is **not** seeded into `passAResultById`
   and is re-attempted, and the pass returns `failedCount: 1` with
   `attemptedAll: true`.
8. *Failure blocks freshness* — a full run that attempts every in-scope unit but
   ends with one failure must still write `partial: true`, so a second run
   recomputes and retries it rather than reading a fresh artifact.
9. *Corrupt `pass_a_units` row, cache level* — hand-write a row whose
   `result_json` is truncated, and another that parses but fails the `Unit`
   schema. Call `getPassAUnits` directly and assert it returns neither, deletes
   both, and does not throw. Pure `ContentCache` test — no Pass A involved.
10. *Corrupt row, resume level* — the same two rows, exercised through a real
   resumed run: assert it does not throw and the affected units are re-analyzed
   rather than entering the snapshot invalid.
11. *Scope* — `--scope 'u:backend.services.**'` analyzes only matching units,
   leaves others structural, and keeps the snapshot schema-valid; a later unscoped
   run completes the remainder rather than short-circuiting on a "fresh" artifact.
   Assert the exact pattern including the `u:` prefix, and add a companion case
   showing the unprefixed `backend.services.**` matches **nothing** — that silent
   no-op is the failure this pins down.
12. *Bad response, write side* — a provider returning malformed JSON once then
   valid JSON succeeds via retry; assert no unparseable row is left in `cache`.
13. *Bad response, read side* — **pre-seed the cache** with a poisoned row, then
   run with a provider that would return valid output; assert the row is deleted,
   the provider is actually called, and the call is recorded `cacheHit: false`.
   Cover both flavours: malformed JSON, **and valid JSON that fails the Zod
   schema** — the latter is what the sweep cannot detect, so a parse-only test
   would pass while the defect survived.
14. *Store round-trip* — `setPassAUnit` then `getPassAUnits` returns the record
   with its `status`; a row written under a different `struct_hash`, `promptRev`,
   `provider`, or `model` is not returned; when both a stale and a current
   `struct_hash` row exist for one unit, only the current one comes back. Pure
   `ContentCache` test.
15. *Cleanup runs once* — open a `ContentCache` twice over a populated DB; assert
   the sweep executes on the first open only (marker set) and the second open
   parses no rows.
16. *Atomic writes* — a `writeArtifact` interrupted mid-write (final flush
   included) leaves the previous artifact intact and parseable, never a truncated
   file.

**End-to-end** against the real repro (`../eq_to_word_problem`, ollama
`qwen3.5:9b-mlx`):

```sh
scv analyze . functions              # interrupt with Ctrl-C after ~10 units
scv analyze . functions              # resume
```

Then confirm the resume actually hit cache:

```sh
sqlite3 .scv/cache.sqlite \
  "select cache_hit, count(*), sum(duration_ms)/1000 from llm_calls
   where pass='A' group by cache_hit;"
```

Success = the second run shows `cache_hit=1` for every previously-completed
unit at `0ms`, versus today's 14 re-analyzed units and 349 wasted seconds.
Also verify `scv analyze . --no-llm` mid-interruption writes a snapshot whose
completed units carry semantics.

## Relationship to prior plans

`archive/incremental-artifact-analyze.md` built the artifact layer this plan
extends — `.scv/artifacts/<sha>/`, `ARTIFACT_DEPENDENCIES`, `ensureArtifact`,
`computeInputHash`, and the `[artifact]` positional. It made staleness
*per-artifact*; this plan makes progress *per-unit* within the `functions`
artifact, which that design left as an all-or-nothing stage.

Its per-file extraction cache (`.scv/artifacts/extraction-files/`, keyed by
content hash and deliberately not sha-scoped) is direct precedent for the
per-unit store proposed here: same idea, one level further in.

`clusters-artifact-split.md` and `no-llm-merge-and-provenance.md` established
that downstream passes tolerate `semantics: null` — the property item 2 relies
on to render a partial run.

## Out of scope

- `scv analyze functions` parsing `functions` as `[root]` — filed separately at
  `docs/backlog/analyze-positional-args-ambiguity.md`.
- `promptRev` invalidating the whole cache on a prompt edit (real, but distinct;
  the `p1`/`p4` split observed earlier was in semantic_viz's own `.scv`, not the
  repro repo).
- Resumability for Pass B/C/D — Pass A dominates runtime.

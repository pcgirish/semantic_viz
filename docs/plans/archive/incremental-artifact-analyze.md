# Incremental, artifact-based `scv analyze`

## Context

`scv analyze` today is monolithic: every run re-parses every file (`extractRepo`), and unconditionally re-runs every interpreter pass (functions/docs/layers/groups/flows), writing one merged `.scv/snapshots/<sha>.json`. The only incrementality is at the LLM-call layer (`CachedProvider`/`cache.sqlite`, keyed by prompt content hash) — cheap on cache hit, but every stage still executes and nothing upstream is skipped structurally. There's also no way to run one stage without the others, and no LLM-free mode.

The goal: make each analysis artifact — **extraction**, **functions** (Pass A), **docs** (Pass Docs), **layers** (Pass B clustering + Pass C narration), **groups** (Pass C groups), **flows** (Pass C flows) — independently computable, persisted, and dependency-aware, so:
- `scv analyze` still does the full thing by default, but skips any stage whose inputs are unchanged since last run (not just cheap-replays it via LLM cache).
- `scv analyze <artifact>` (e.g. `scv analyze layers`) computes just that artifact, transparently freshening its dependencies first if they're stale, without re-running unrelated stages.
- `scv analyze --no-llm` means "run extraction only, stop before functions" — a natural consequence of the dependency model, not special-cased logic.
- Extraction itself becomes incremental (file-hash-cached), since it's the actual bottleneck on large repos and every artifact ultimately depends on it.

**No server or UI changes are required.** Confirmed: `packages/server/src/store.ts` (`SnapshotStore.getSnapshot`) and the `GET /api/snapshot/:sha` route only ever read one complete `.scv/snapshots/<sha>.json` and return it verbatim; the UI (`packages/ui/src/App.tsx`) fetches that single JSON blob and already tolerates per-unit `null` `semantics`/`cost` (`Inspector.tsx`) and reads `Unit.provenance.source`/`pass` (already `"static"|"llm"` / `"A"|"B"|"C"|"D"`, per `packages/schema/src/index.ts`). `runAnalyze()` will keep writing that same final merged snapshot at the end — internals change, the on-disk/wire contract doesn't.

## Current pipeline (facts gathered, no changes to these signatures except where noted)

- `packages/cli/src/analyze.ts` `runAnalyze()` (lines 49-95): always `extractRepo()` → `toSnapshot()` → `runInterpreter()` (all passes) → write `.scv/snapshots/<sha>.json`. No staleness check anywhere.
- `packages/extractor/src/index.ts` `extractRepo(root)`: `parseRepoFiles(root)` (per-file parse+AST-walk, `host.ts` lines 30-44, always full re-parse) → `knownModulesOf` → `parseManifests` → `churnByFile` (git log, always rerun) → `resolveGraph(files, knownModules, manifests, churn)` (`resolve.ts`, cross-links `FileFacts[]` into `SymbolGraph.units/edges/externals`).
  - **Key seam**: `parseRepoFiles` returns `FileFacts[]`, one entry per file, each independently derived from that file's content only (`host.ts` lines 33-41: read file → parse → walk). `resolveGraph` is the only step that needs the *whole* `FileFacts[]` list (cross-file import/call resolution) — it's fast (in-memory graph building, no I/O), so it can stay a full pass over a partially-cached fact list.
- `packages/interpreter/src/orchestrate.ts` `runInterpreter()`: Pass A (per-leaf-unit, bottom-up via `runInDependencyOrder`, lines 209-262) → Pass Docs (398-406) → Pass B (408-410, clustering) → Pass C layers (424-426, narration) → Pass C groups (454-462) → Pass C flows (547-617) → finalize (643-693).
- `packages/interpreter/src/cached-provider.ts` / `cache.ts`: per-LLM-call cache keyed on `sha1(prompt + system + cacheKeyExtra)` + `promptRev` + `provider` + `model`, stored in `.scv/cache.sqlite`. Stays as-is — it's the right layer for "did this exact prompt change," complementary to (not replaced by) artifact-level staleness.
- `packages/schema/src/index.ts`: `Unit.semantics`/`cost` `.nullable()`; `Unit.provenance = { source: "static"|"llm", pass?: "A"|"B"|"C"|"D" }`. Reused as-is for the final merged snapshot.
- Data dependencies between passes (already implicit in function signatures, orchestrate.ts):
  - **functions** (Pass A) ← extraction (SymbolGraph units, call graph, source text)
  - **docs** (Pass Docs) ← repo doc files (independent of functions)
  - **layers** (Pass B + Pass C narration) ← functions' one-liners, import edges, docs
  - **groups** (Pass C groups) ← layers (names + `why` + layer-to-layer edges)
  - **flows** (Pass C flows) ← functions (leaf semantics), call graph

## Design

### 1. `.scv/` artifact persistence layout
New directory: `.scv/artifacts/<sha>/`:
- `extraction.json` — persisted `SymbolGraph` (today only ever held in memory).
- `functions.json` — Pass A results keyed by unit id (semantics/cost/signature/tags per unit) + the input hash each was computed from.
- `docs.json` — Pass Docs extracts.
- `layers.json` — Pass B clusters + Pass C narration per layer, plus the input hash they were computed from.
- `groups.json` — Pass C group assignments + input hash.
- `flows.json` — Pass C flow units + input hash.

Each file stores `{ inputHash: string, data: ... }`. `inputHash` is a content hash of exactly that artifact's declared dependencies (see below) — this is the staleness signal, independent of and in addition to `CachedProvider`'s own per-prompt cache.

Per-file extraction cache: `.scv/artifacts/extraction-files/<hash-of-relpath>.json` storing `{ contentHash: string, facts: FileFacts }` — one entry per source file, keyed by file path, invalidated by content hash (sha1 of file bytes). This is what makes `parseRepoFiles` incremental: for each file, hash its current contents; if a cache entry exists with a matching `contentHash`, reuse the persisted `FileFacts` instead of re-parsing. This cache is **not** sha-scoped (it survives across commits — only file content matters), unlike the per-commit `artifacts/<sha>/` files.

### 2. Dependency/staleness model
New module `packages/interpreter/src/artifacts.ts` (or `packages/cli/src/artifacts.ts` if it needs `extractRepo` too — likely the latter, since it spans extraction + interpreter):
- A small static table: `{ functions: ["extraction"], docs: [], layers: ["functions", "docs"], groups: ["layers"], flows: ["functions", "extraction"] }` (mirrors the data-dependency list above).
- `computeInputHash(artifact, deps...)`: hashes the relevant upstream artifact's persisted `inputHash`/content (e.g. `layers`'s input hash = sha1 of functions' one-liners + import edges + docs content — the same values already fed into `passBPrompt`/`passCPrompt` today, just hashed once instead of re-sent to the LLM-cache layer blind).
- `ensureArtifact(artifact, sha, ctx)`: recursive — for each dependency, `ensureArtifact(dep, ...)` first (freshening upstream), then compute this artifact's current `inputHash` from the now-fresh dependencies; if a persisted `.scv/artifacts/<sha>/<artifact>.json` exists with matching `inputHash`, load and return it; otherwise compute (calling into the existing Pass A/Docs/B/C functions, unchanged) and persist.
- This is the "cascading recompute" the user asked about: calling `ensureArtifact("layers", ...)` transparently ensures `functions` and `docs` are current first, without recomputing `groups`/`flows` (which depend on `layers`/`functions` but aren't upstream of it).

### 3. CLI surface
- `packages/cli/src/bin.ts`: extend `analyze` command to accept an optional positional artifact name: `scv analyze [artifact]` where `artifact` ∈ `functions|docs|layers|groups|flows` (omitted = full pipeline, i.e. `ensureArtifact("flows")` plus `groups` since both are leaves with no further downstream — full pipeline is just "ensure every leaf artifact").
- `--no-llm` flag: equivalent to running extraction only — i.e. skip calling `ensureArtifact` for `functions` onward, write a snapshot containing only static units/edges (`semantics: null` throughout, matching schema's existing nullable support). No separate code path — it's "stop point = extraction" in the same dependency walker.
- `runAnalyze()` (`packages/cli/src/analyze.ts`) becomes: run/ensure extraction artifact (incremental per-file), then if `--no-llm` stop and assemble structural-only snapshot; else `ensureArtifact("flows")` + `ensureArtifact("groups")` (both leaves), assemble final merged snapshot from persisted artifacts, write `.scv/snapshots/<sha>.json` same as today.
- `scv analyze layers` etc.: same `ensureArtifact` call for just that one artifact, then **always** reassembles and writes a full `.scv/snapshots/<sha>.json`, reusing whatever's currently persisted for every other artifact (or leaving those units/fields absent/null if never computed for this sha). This keeps one invariant: the snapshot on disk always reflects the latest state of all persisted artifacts, regardless of which artifact command last ran — no separate "artifact-only" write path.

### 4. Extraction incrementality
- `packages/extractor/src/host.ts` `parseRepoFiles(root)`: for each file, compute `sha1(fileBytes)`; check `.scv/artifacts/extraction-files/<hash of relpath>.json`; on hit with matching content hash, use cached `FileFacts`; on miss, parse as today and persist. This needs a cache-dir parameter threaded into `extractRepo`/`parseRepoFiles` (currently take only `root`) — add an optional `cacheDir?: string` param, default to no caching (keeps `packages/extractor` usable standalone/in tests without I/O side effects when not given a cache dir).
- `churnByFile` (git log) and manifest parsing stay non-incremental (cheap, single git subprocess + small manifest files — not the bottleneck).

### 5. Layer/group naming quality (prefer real names over invented ones)
Root cause: `packages/interpreter/src/prompts/pass-b.ts` (line 34) and `packages/interpreter/src/prompts/pass-c-groups.ts` (line 29) both instruct the LLM to invent a "short, meaningful name" and give abstract example names (`"ops"`, `"api"`, `"orders"`; `"api surface"`, `"core domain"`, `"platform"`). `"core domain"` is the likely direct source of the `"core-*"`/`"*-domain-<n>"` pattern the user flagged. This happens despite the orchestrator already surfacing good naming signal: `orchestrate.ts`'s `formatRepoContext(docExtracts, files)` (lines 147-169) feeds Pass Docs' `DocExtract.modules[].name` and a real directory tree (`buildDirectoryTree`) into `repoContext`, which both prompts already receive — the gap is prompt *rules*, not missing data.

Fix, no data-flow changes needed:
- `prompts/pass-b.ts` line 33's rule ("prefer grouping accordingly") stays for file placement; add/replace line 34 to require reusing an existing name: if a directory name or a `repoContext`-listed module name plausibly matches the cluster's files, use that name verbatim (not a paraphrase); only invent a new short name when nothing in `repoContext` or the file paths reasonably fits. Drop the invented-style examples (`"ops"`, `"api"`, `"orders"`) in favor of either no examples or an explicit worked example showing verbatim reuse of a directory/doc name.
- `prompts/pass-c-groups.ts` line 29: same rule — prefer an existing directory/doc-derived name covering the group's constituent layers; remove `"api surface"`, `"core domain"`, `"platform"` example names entirely.
- Structural-only path (extraction-only / `--no-llm`, using `directoryClusters()` per the earlier `--no-llm` design note): already names clusters by directory path directly — no change needed, but call this out as the consistent baseline the LLM-naming rules above are matching.
- Add to Verification: a fixture repo with a clear directory structure and a `docs/design.md` naming its modules — assert Pass B/C group and layer names in the resulting snapshot match those real directory/doc names rather than producing generic invented ones (e.g. no `"core-*"`/`"*-domain-*"`-shaped names when a real name was available).

## Verification
- `npm test` in `packages/extractor`, `packages/interpreter`, `packages/cli`:
  - New test: modifying one file and rerunning extraction only reparses that file (assert via spy on the parser call count, or by asserting unrelated files' `FileFacts` are byte-identical object references from cache).
  - New test: `scv analyze functions` then `scv analyze layers` computes layers using persisted functions without recalling Pass A (assert via provider call count / mock).
  - New test: changing a doc file invalidates `docs` and `layers` (since layers depend on docs) but not `functions`.
  - New test: `scv analyze --no-llm` produces a snapshot with only static units, `semantics: null`, matching current schema expectations (reuse of `Unit.semantics.nullable()`, already valid).
  - New test: running `scv analyze` twice with no changes performs zero LLM calls (all artifacts fresh) and zero re-parses (all files cache-hit).
- `npm run lint` at repo root.
- Manually run `scv analyze`, then touch one file, then `scv analyze layers`, confirming (via `--log-level info` timing/usage output) that only the affected artifacts recompute, and that `.scv/snapshots/<sha>.json` is rewritten each time.
- Confirm server/UI need no changes: run `scv serve` + `scv ui` against a snapshot produced by the new incremental path and visually confirm it renders identically to today's output for an unchanged repo (per project's fixture-based validation convention, not claude-cli).

# Publishable scv: committed semantic metadata, written by agents before merge

## Context
Goal: other teams can install scv and keep semantic metadata **in their own repo**, versioned per revision by git, without re-running analysis.

Today:
- `.scv/` is gitignored as a whole (`.gitignore:11`).
- The cache is keyed by commit sha (`.scv/artifacts/<sha>/`). A commit can't contain files keyed by its own sha, so this layout can't be checked in.
- No `export` or `check` command exists; the CLI has `analyze`, `diff`, `merge-semantics`, `serve` and `ui` (`packages/cli/src/bin.ts:11-131`).
- The CLI depends on `@scv/ui` and `@scv/server` at runtime, so installing it pulls in the viewer.
- The repo has no CI, and the package is `private`.

Decisions (confirmed):
- **Who writes metadata:** the coding agent, before merge, in the PR branch, using the skills. This costs zero LLM calls.
- **What CI does:** a deterministic `scv check` that fails on stale metadata. CI never calls an LLM.
- **How it ships:** the `scv` CLI on npm, plus `npx scv init` to install the skills and templates.
- **Packaging:** split into a lean `scv` package (analyze/merge/check) and `@scv/viewer` (serve/ui).

Each phase below is its own branch and PR, following the CLAUDE.md code flow and TDD.

## Phase 0: Stop artifact churn (prerequisite) — done
Committed files must not change when nothing semantic changed.
Fixes `docs/backlog/unconditional-artifact-rewrites.md` by separating two identities that are currently conflated:
- **Runtime cache key** (unchanged): `computeInputHash` keeps `promptRev` and `scopeKey` (`artifacts.ts:222`), so a prompt-revision bump still invalidates narration and a scoped artifact is never taken for a whole-repo one.
- **Content hash** (new): a deterministic hash of the artifact payload alone. `merge-semantics` (`merge-semantics.ts:390`) skips the write when the content hash is unchanged. Phase 1 fingerprints are built on content, not on the runtime key.
- Deterministic serialization: sorted keys and stable array order.
- Tests: no-op merge leaves files and mtimes untouched and the assembled snapshot (including flows) stays populated; `promptRev` bump still invalidates; scoped artifact still isolated from a full run.

## Phase 1: Committed store and export/hydrate — done
- **New committed layout `.scv/semantics/`**, keyed by unit id rather than commit sha.
  - Function/class semantics are sharded **per source file** (`functions/<encoded-src-path>.json`) so parallel PRs rarely conflict. Path encoding is reversible and must stay contained under `functions/`.
  - Global narration stays one file each: `docs.json`, `layers.json`, `groups.json`, `flows.json`.
  - Every file carries a `storeVersion` and is validated with Zod on read; unsupported versions or malformed data are rejected before hydrate or check.
- **Freshness fingerprints** (sha-independent, deterministic, recomputable from the worktree alone):
  - Function/class entry: `hash.struct` + `hash.text` from the extractor (`packages/extractor/src/resolve.ts:147`; `hash.struct` alone misses body edits), plus the unit's sorted caller/callee qualnames and a digest of its direct callees' committed semantics. These are the inputs Pass A sees (`packages/interpreter/src/pass-a.ts:56-72`), so a renamed callee, changed call edge, or re-authored callee makes the caller stale. Callees in the caller's own strongly connected component are excluded from the digest, so recursion cycles don't invalidate themselves forever.
  - **Fingerprints are stamped at authoring time, never at export.** An entry's fingerprint is recorded when its semantics are merged (`merge-semantics`) from the inputs current at that moment; hydrated entries keep the fingerprint they were committed with.
  - `docs.json`: hash of each source document's path + content.
  - `layers.json` / `groups.json` / `flows.json`: the same upstream inputs their artifact hashes already use (`packages/cli/src/artifacts.ts:227-263`): cluster file sets, unit narration, edges, upstream layer narration, graph hash. Excludes `promptRev`/`scopeKey` (runtime-cache concerns, Phase 0). One shared function computes these for both export and check.
- **`scv export`:** an atomic merge into the store. It writes an entry only if its stamped fingerprint matches the current inputs; it never re-stamps. Stale entries are left as they are in the store (and `check` keeps flagging them); entries whose unit/document no longer exists are pruned. Unchanged semantics are never dropped.
- **`scv hydrate [rev]`** (default `HEAD`):
  1. Resolve `rev` to a sha (git invoked with argument arrays, never a shell).
  2. Get that revision's full `SymbolGraph` by extraction, always: for `HEAD` on a clean worktree, extract in place; otherwise extract from a temporary detached worktree (`git worktree add --detach` into a private temp dir, removed in `finally`, including on git/extraction failure). Persisted `scv/1` snapshots are never used as the structure: `graphFromSnapshot` drops routes, block graphs and `via: "di"` edges, and `mergeFlows` rejects them (`merge-semantics.ts:900-914`).
  3. Read the store at that rev (`git show <sha>:.scv/semantics/...`) and merge the fresh entries into `.scv/artifacts/<sha>/` via the merge path in `packages/cli/src/merge-semantics.ts`, called with that sha and snapshot.
  The viewer then gets per-revision snapshots straight from git history.
- **Path safety:** containment checks on `.scv/semantics` resolve symlinks before reading or writing; for new files, the nearest existing ancestor is resolved and checked.
- **Ignore rules:** narrow `.gitignore` from `.scv/` to all local/generated paths: `cache.sqlite`, `artifacts/`, `snapshots/`, `deltas/`, `layouts/` (viewer, `packages/server/src/store.ts`), `pending/` (agent skills), `config.yaml`. Only `.scv/semantics/` is commit-eligible.

## Phase 2: `scv check` — done
- `scv check [--base <ref>]` runs a `--no-llm` extraction and recomputes every fingerprint from Phase 1, then compares against the committed store. It reports:
  - stale: the fingerprint differs (functions, docs, layers, groups, flows)
  - missing: a new unit or document has no entry
  - orphaned: an entry's unit or document no longer exists
- Exit code is non-zero on any of these. Output is machine-readable: each item names its kind (`function | docs | layers | groups | flows`), id, and the skill that fixes it (`agent-analyze-functions`, `-docs`, `-layers`, `-groups`, `-flows`).
- `--base <ref>` limits function-level reporting to units whose fingerprint inputs changed since `git merge-base <ref> HEAD`: units in changed files plus everything stale through the caller chain, even when the caller's file is outside the diff. Global artifacts are always checked. An unresolvable base ref is an error (non-zero exit with a clear message), never a silent full or empty check.

## Phase 3: Skills write to the committed store — done
- **New skill `agent-analyze-pr`:** incremental, before opening a PR. Precondition: changes are committed and the worktree is clean (the skill stops and says so otherwise), so HEAD-keyed artifacts and the live check describe the same source.
  - **Input `base`** (optional): the ref the PR targets. Default: the remote HEAD of the current branch's upstream remote (`git symbolic-ref refs/remotes/<remote>/HEAD`); if there is no upstream, the only configured remote. If neither resolves, the skill asks for `base` rather than guessing.
  1. `scv hydrate` (HEAD) to seed the current sha's artifacts with every committed entry that is still fresh.
  2. `scv check --base <base>`
  3. Loop until `scv check` reports nothing (fixed point), each pass in dependency order, touching only what `check` reports:
     - functions, bottom-up (callees before callers; `agent-analyze-functions` format) → `merge-semantics`
     - docs (`agent-analyze-docs`) → merge
     - deterministic clustering (`agent-analyze-clusters`) whenever functions or docs changed this pass
     - layers → groups → flows (their skills) → merge
     - `scv export` at the end of each pass, so the next `check` reads the updated store from the working tree (it stays uncommitted until the final clean check)
     Re-authoring upstream narration can newly invalidate downstream entries (callee → caller, docs/functions → layers, layers → groups); the next pass picks them up. It terminates because invalidation only flows downstream along an acyclic order (SCC-condensed call graph, then docs/functions → clusters → layers → groups, flows).
  4. Final `scv check` passes → commit `.scv/semantics/` in the same PR.
- **Existing `agent-analyze-repo`:** for the first full bootstrap, end with `scv export`.
- **Skill wording:** replace monorepo source citations in the skills (e.g. `packages/interpreter/src/pass-b.ts`) with behavior descriptions, so the skills read correctly outside this repo.

## Phase 4: Package split and npm publish — done

> Done: npm `scv` and the `@scv` scope are taken, so everything is published under `semviz` — CLI package `semviz` (bin `scv`), libraries `@semviz/{schema,extractor,interpreter,differ}`, viewer `@semviz/viewer` (bin `scv-viewer`); all workspaces were renamed `@scv/*` → `@semviz/*`. Publishing requires creating the npm org `semviz`. Phase 5's `init` uses `semviz`, i.e. `npx semviz@<version> check`.

- **Lean `scv`:** move `serve`/`ui` and the Fastify/`@scv/ui`/`@scv/server` dependencies out of `packages/cli` into new `packages/viewer` (`@scv/viewer`, bin `scv-viewer`). `packages/cli` keeps analyze, diff, merge-semantics, export, hydrate, check and init.
- **Viewer is self-contained:** `@scv/viewer` bundles its runtime instead of depending on private workspaces. The browser app (`@scv/ui` and its private deps: `@scv/design-system`, `@scv/layout`, `@scv/skin-contract`, `@scv/skin-tiles`, `@scv/skin-tiles3d`) ships as prebuilt static assets; `@scv/server` is bundled into the viewer's JS. Its npm runtime deps are only third-party packages plus `@scv/schema`. Those UI/server packages stay private.
- **Publish config:** make `scv`, `@scv/schema`, `@scv/extractor`, `@scv/interpreter`, `@scv/differ` and `@scv/viewer` publishable: drop `private`, add `files`/`exports`/`engines`, `publishConfig.access: public` for scoped packages, and replace `*` versions with real ones. The root stays private.
- **Bundle the skills:** copy `.agents/skills/agent-analyze-*` into the `scv` package at build time.
- Check whether the npm name `scv` (and the `@scv` scope) is available, and choose a fallback if not. Workflow templates and docs generated by `init` use the actual published package name.

## Phase 5: `scv init` — done

> Done: `scv init [root] [--install npm|git] [--git-ref <ref>]`. Because nothing is published yet, the workflow's install is configurable: `npm` runs `npx --yes --package semviz@<version> scv check`; `git` clones this repo at a pinned ref, builds `packages/cli` and runs its `dist/bin.js` — the default when init runs from a source checkout, pinned to its HEAD. `${{ github.base_ref }}` reaches the shell only through `env`. Per-file outcomes are `created` / `updated` (lines appended) / `unchanged` / `kept` (differs, left alone); init warns when `.gitignore` ignores `.scv/` as a whole.

`npx scv init` in the target repo:
- Copies the bundled `agent-analyze-*` skills into `.agents/skills/`, and symlinks `.claude/skills` if absent.
- Writes the `.gitignore` entries (from Phase 1).
- Writes `.gitattributes`: `.scv/semantics/** linguist-generated=true`, which collapses the files in PR review but keeps them diffable, so reviewers can still read agent-authored narration.
- Writes `.github/workflows/scv-check.yml` for pull requests:
  - `actions/checkout` with `fetch-depth: 0`, so the base branch and merge base exist locally.
  - `actions/setup-node` with the package's supported Node version (from its `engines` field).
  - Runs `npx scv@<installed version> check --base origin/${{ github.base_ref }}`, pinned to the version that ran `init`.
- Prints the first-bootstrap command (run the `agent-analyze-repo` skill, then commit `.scv/semantics/`).
- Appends an `AGENTS.md` snippet: "Before opening a PR, run the `agent-analyze-pr` skill."
- Is idempotent and never overwrites user-modified files.

## Phase 6: Dogfood and docs
- Add the same `scv-check` workflow to this repo, bootstrap `.scv/semantics/`, and commit it.
- Write a README "Use in your repo" section.
- Update `docs/spec/roadmap.md`: this replaces the `scv export --structural` bullet.

## Critical files
- `packages/cli/src/bin.ts`: register `export`, `hydrate`, `check` and `init`; remove `serve`/`ui` from this package.
- `packages/cli/src/merge-semantics.ts` and `packages/cli/src/artifacts.ts`: churn fix and the hydrate path.
- `packages/cli/package.json`, new `packages/viewer/`, root `package.json` workspaces.
- `.agents/skills/agent-analyze-*/SKILL.md`, new `.agents/skills/agent-analyze-pr/SKILL.md`.
- `packages/extractor/src/resolve.ts`: source of `hash.struct`/`hash.text` used in function fingerprints.
- `.gitignore`, new `.github/workflows/scv-check.yml`.

## Risks
- **Merge conflicts on global files** (`layers.json`, `flows.json`): resolve by re-running `agent-analyze-pr`, since `check` flags them. Document this; don't build a custom merge driver.
- **Agents skipping the skill:** CI `check` is the backstop and blocks the merge.
- **Repo growth:** small, because the store holds only the latest state and git deltas store the history.

## Verification
- Unit tests for each new command:
  - export round-trip (export → hydrate → identical artifacts); export after a one-unit change keeps all other entries
  - check: body-only edit is stale; edge-only change and callee-semantics-only change mark the caller stale, including a caller outside the `--base` diff; A→B→C chain: changing C eventually flags A, and export never writes A until it is re-authored; a recursion cycle does not loop forever; a docs change that newly invalidates layers, and a layer re-author that newly invalidates groups, are both resolved by the loop; doc edit flags `docs.json`; edge change flags groups/flows; stale/missing/orphaned; bad base ref errors
  - hydrate of a historical rev uses that rev's structure, not the worktree's
  - store schema rejects unknown `storeVersion` and malformed files
  - init idempotence
- `fixtures/orderly`, end to end:
  1. bootstrap → export → commit
  2. edit one function → `check` fails, naming that unit
  3. `agent-analyze-pr` → `check` passes
  4. `hydrate HEAD~1` → `scv-viewer` shows both revisions in Delta
- Clean build, then `npm pack` every publishable package; install the `scv` and `@scv/viewer` tarballs into a scratch repo with no workspace access; run `npx scv init`, `scv check`, and `scv-viewer` there.
- hydrate: temp worktree removed after success and after an induced git failure; base-ref default resolution (upstream remote, sole remote, unresolvable → asks).
- `npm run test` and `npm run lint` pass for each phase.

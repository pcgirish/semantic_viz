---
name: agent-analyze-pr
description: Bring a branch's committed scv semantics (.scv/semantics/) up to date before opening a PR — re-author only what `scv check --base` reports, in dependency order, until it reports nothing, then commit the store in the same PR. Zero LLM/provider calls. Use before opening or updating a PR on a repo that commits its scv semantics.
---

# Incremental analysis for a PR, zero provider calls

`agent-analyze-repo` bootstraps a repo's committed store once. After that, each
PR re-authors only what its own changes made stale, missing or orphaned, so the
store merged with the PR matches the code merged with it.

## Precondition: committed changes, clean worktree

Run `git status --porcelain`. If it prints anything, **stop** and tell the user
to commit or stash first. Check compares the store against the committed code,
and the final commit must contain only the store.

## Resolve `base`

Use `base` if the user gave one. Otherwise:

1. Find the current branch's upstream remote:
   `git rev-parse --abbrev-ref --symbolic-full-name @{upstream}` gives
   `<remote>/<branch>`; take `<remote>`. Resolve its default branch with
   `git symbolic-ref --short refs/remotes/<remote>/HEAD` (e.g. `origin/main`).
2. If there is no upstream and `git remote` lists exactly one remote, use that
   remote in the same `symbolic-ref` command.
3. If neither resolves, **ask the user for `base`**. Do not guess `main`.

## Steps

1. **Hydrate** HEAD's committed store into the local artifact cache, so
   unchanged semantics need no re-authoring:

   ```sh
   scv hydrate
   ```

2. **Check** what this branch needs:

   ```sh
   scv check --base <base> --json
   ```

   Each item is `{status, kind, id, skill, file?}`: `status` is `stale`,
   `missing` or `orphaned`; `kind` is `function`, `docs`, `layers`, `groups` or
   `flows`; `skill` names the skill that re-authors it. Exit 0 with no items
   means the store is current: skip to step 4.

3. **Re-author until check reports nothing.** Each pass touches only reported
   items, in this order:

   1. **Functions**, bottom-up — callees before callers — in the
      `agent-analyze-functions` pending format, then `scv merge-semantics`.
      A caller's fingerprint covers its callees' semantics, so authoring a
      caller first would leave it stale again.
   2. **Docs**, per `agent-analyze-docs`, merged `--with-docs`.
   3. **Clusters**, per `agent-analyze-clusters`, whenever this pass changed
      any function or doc. It is deterministic; only run it.
   4. **Layers → groups → flows**, per their skills, each merged with its own
      flag. Layers must match the fresh clusters' file sets exactly.
   5. **Export** the pass into the working tree's store:

      ```sh
      scv export
      ```

   Then re-run `scv check --base <base> --json`. Leave `.scv/semantics/`
   uncommitted until a check is clean.

   **Orphaned** items need no authoring: export drops entries whose unit or doc
   no longer exists.

   The loop terminates. Staleness flows only downstream along an acyclic order:
   the call graph condensed into strongly connected components, then
   functions and docs → clusters → layers → groups and flows. Authoring a level
   never invalidates a level before it, so each pass settles at least one more
   level.

4. **Commit the store** in the same PR once the final check is clean:

   ```sh
   git add .scv/semantics/
   git commit -m "chore: update scv semantics"
   ```

## Pass `--no-llm` on every analyze

Clustering runs `scv analyze <root> clusters --no-llm`. Without `--no-llm`, the
analyze freshens dependencies first and may call the provider.

## Merge conflicts on global files

`layers.json`, `groups.json` and `flows.json` are one file each for the whole
repo, so two PRs touching them conflict. Do not hand-merge. Take either side,
finish the merge, and re-run this skill: check flags the global as stale against
the merged code, and the loop re-authors it.

## Failure modes

- **Check keeps reporting the same function** — it was authored before one of
  its callees changed. Author callees first, then re-author it.
- **Check reports `missing` for every global** — the store was never
  bootstrapped. Run `agent-analyze-repo` instead.
- **`cannot resolve --base`** — the ref does not exist locally. Fetch the
  remote, or ask the user for `base`.

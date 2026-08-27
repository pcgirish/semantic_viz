---
name: agent-analyze-clusters
description: Run scv's deterministic file clustering (Pass B) with zero LLM/provider calls, after verifying its inputs are really narrated, and report the cluster file sets that agent-analyze-layers must match exactly. Use after functions and docs are authored, before naming layers.
---

# Deterministic clustering (Pass B)

**There is nothing to author here.** Pass B is deterministic — it partitions the
repo's files into clusters from the import graph alone and takes no provider
argument (`packages/interpreter/src/pass-b.ts`). Layer *names and narration* are
`agent-analyze-layers`, a separate step.

What this skill does is verify the inputs, run the pass, and hand the real
cluster file sets to the next step.

## Verify the inputs first — this is the point of the skill

Pass B is deterministic but **consumes `functions` and `docs`**, both of which
are provider-backed and may be empty defaults. Clustering over empty inputs
succeeds and writes a cache-fresh `clusters.json`, so a poor grouping is
indistinguishable from a good one on the next run. Check before running.

For `docs`, `docs.json === []` is ambiguous on its own — it is equally a
faithful narration of a repo with no docs and a `--no-llm` empty default.
Disambiguate against the discovered doc paths (`classifyDocsNarration` in
`packages/cli/src/docs-narration.ts` implements this):

| Status | Meaning | Action |
|---|---|---|
| `narrated` | every discovered doc has an extract | Proceed |
| `none-discovered` | the repo has no docs at all | Proceed — a legitimate shape, nothing to fix |
| `absent` | no `docs` artifact exists | **Stop**; run `agent-analyze-docs` |
| `defaulted` | docs were discovered, none narrated | **Stop**; run `agent-analyze-docs` |
| `partial` | some narrated, some missing | Proceed, but report the missing paths |

Apply the same standard to `functions`: if its units carry no semantics, run
`agent-analyze-functions` first.

## Run it

```sh
scv analyze <root> clusters --no-llm
```

`--no-llm` is what makes this safe. `clusters` is deterministic, so it is
computed for real even under `--no-llm` — but its provider-backed dependencies
are not, and without the flag a bare `scv analyze <root> clusters` would
freshen `functions` and `docs` by **calling the provider**, breaking the chain's
zero-call guarantee.

Under `--no-llm` a defaulted dependency is refused outright rather than
silently clustered over:

```
error: cannot compute clusters: these dependencies are not narrated —
       functions (run agent-analyze-functions), docs (run agent-analyze-docs)
```

That is the pre-flight check enforced by the CLI. Nothing is written when it
fires, so there is no poisoned artifact to clear — narrate the named stages and
re-run the same command.

## Report

Read `.scv/artifacts/<sha>/clusters.json`:

- **cluster count** — `data.groups.length`.
- **`data.modularity`** vs **`data.directoryModularity`** — the import-graph
  partition against a naive one-cluster-per-directory baseline. Higher
  modularity than the directory baseline means the code's real coupling
  disagrees with its folder layout, which is the interesting signal.
- **the file sets** — `data.groups` is an array of `[clusterId, files[]]`.

`agent-analyze-layers` must match these `files` sets **exactly**. Point at the
artifact path rather than transcribing the sets from memory.

## Next

`agent-analyze-layers`, which names and narrates these clusters.

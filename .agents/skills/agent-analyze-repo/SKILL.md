---
name: agent-analyze-repo
description: Produce a complete scv snapshot for a repo — structure, function semantics, docs, clusters, layers, groups, and flows — by running the agent-analyze skill chain in dependency order with zero LLM/provider calls. Use when asked to analyze or visualize a whole repo with scv without paying for provider calls.
---

# Analyze a whole repo, zero provider calls

`scv analyze` has seven stages. One is structural, two are deterministic, and
four are normally LLM passes. This chain replaces those four with agent-authored
narration merged straight into the artifact cache, producing a complete snapshot
for `scv ui` without a single provider call.

Each step's merge writes an artifact whose `inputHash` a later `scv analyze`
matches, so nothing recomputes and the final confirming run costs nothing.

## The chain

| # | Skill | Stage | Kind |
|---|---|---|---|
| 1 | `agent-analyze-structure` | extraction + blocks | deterministic |
| 2 | `agent-analyze-functions` | `functions` | authored |
| 3 | `agent-analyze-docs` | `docs` | authored |
| 4 | `agent-analyze-clusters` | `clusters` | deterministic |
| 5 | `agent-analyze-layers` | `layers` | authored (`--with-clustering`) |
| 6 | `agent-analyze-groups` | `groups` | authored (`--with-groups`) |
| 7 | `agent-analyze-flows` | `flows` | authored (`--with-flows`) |

## Dependency rules

- **Step 1 is mandatory and first.** Every later step needs the real unit ids it
  produces. Do not author against ids inferred from reading source.
- **Steps 2 and 3 are independent of each other** and may be authored in either
  order — but **both must precede step 4**. Clustering is deterministic yet
  consumes both; running it over defaulted inputs produces poor groupings that
  are cache-fresh and therefore indistinguishable from good ones. Step 4 refuses
  to run rather than allow this.
- **Step 5 must match step 4's file sets exactly**, from
  `.scv/artifacts/<sha>/clusters.json` — not from memory.
- **Step 6 needs a fresh `layers` artifact**, so it follows step 5.
- **Step 7 does not support `--sha`.** Flow tracing needs live extraction: a
  persisted snapshot carries no dependency-injection edges and no block graph,
  so a flow merged from one would silently differ from the real pipeline's.

## Pass `--no-llm` on every analyze in the chain

The stages this chain runs directly (1 and 4) are deterministic, but
`scv analyze <root> <stage>` freshens that stage's *dependencies* first, and
without `--no-llm` it will call the provider to do so. `--no-llm` blocks that
outright while still computing the deterministic stages for real.

## Parallelizing step 2

On a large repo, `functions` is the bulk of the work. Split it by folder and
author each slice independently, per `agent-analyze-functions`. The merges are
additive, so slices can be merged as they finish.

## Finish

```sh
scv analyze <root>
```

Confirm `usage: ... calls=0` — no provider call anywhere — and that no `[WARN]
snapshot merged without:` line appears. Then:

```sh
scv serve <root>   # and, in another shell
scv ui
```

Layers, groups and flows render with your narration, and double-clicking a
branching function opens a populated Flowchart view.

## Failure modes

- **A stage still reports as empty** — its merge was skipped or its `inputHash`
  no longer matches. Re-run that stage's skill; each one reports per-entry
  warnings for skipped entries rather than failing the whole merge.
- **Step 4 errors with `cannot compute clusters`** — step 2 or 3 has not really
  been narrated. The message names which and what to run. Nothing was written,
  so just narrate and re-run.
- **`calls` is non-zero at the end** — an analyze somewhere in the chain was run
  without `--no-llm`.

Per-stage authoring detail lives in each stage's own skill; this file is only
the chain, the ordering rules, and the failure modes.

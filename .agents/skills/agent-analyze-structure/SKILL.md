---
name: agent-analyze-structure
description: Extract a repo's structural graph — units, edges, and the control-flow blocks that power the Flowchart view — with zero LLM/provider calls, and report what the rest of the agent-analyze chain needs. Use as the mandatory first step before authoring any scv semantics.
---

# Structural extraction (deterministic)

This is the **mandatory first step** of the agent-analyze chain. Nothing else
can be authored until it has run: every other skill needs the real unit ids it
produces, and those ids come from extraction, not from reading the source.

Extraction is pure AST work. It costs no provider calls and authors nothing.

## Run it

```sh
scv analyze <root> --no-llm
```

This writes `.scv/snapshots/<sha>.json` and the `extraction` artifact under
`.scv/artifacts/<sha>/`. Under `--no-llm` the provider-backed stages
(`functions`, `docs`, `layers`, `groups`, `flows`) are assembled from their
empty defaults, which the command reports:

```
[WARN] snapshot merged without: functions, docs, layers, groups, flows — ...
```

That warning is expected here — those are exactly the stages the rest of the
chain authors. `clusters` is absent from that list because it is deterministic
and is genuinely computed.

## Report

Read `.scv/snapshots/<sha>.json` and report:

- **unit count** and **file count** — the size of what follows.
- **block units** (`kind === "block"`) — the Flowchart view's data.
- the snapshot path, as the source of real unit ids for every later skill.

## Block units and the Flowchart view

Block units are function-internal control flow. They are built deterministically
from the extraction graph on every path, including this one — a repo analyzed
entirely through these skills gets working flowcharts.

**Zero block units is not automatically a failure.** Classify it before
reporting, because three different situations produce the same count:

| Situation | What it means | What to say |
|---|---|---|
| `populated` | block units > 0 | Flowchart view works |
| `no-branching` | no function in the repo branches | Correct and complete; nothing to fix |
| `failed-build` | the extraction graph *has* branching edges but no blocks were built | A real bug — report it |
| `historical-unavailable` | the run named a historical `--sha` | Expected: a persisted snapshot carries no block graph |
| `missing-input` | no `extraction.json` | The analysis did not complete |

The distinction between `no-branching` and `failed-build` is not the presence of
blocks in the extraction graph — `resolveBlockGraph` records entry and exit
blocks even for straight-line functions. It is whether any control-flow edge has
an `edgeType` other than `sequential`. `classifyBlockAvailability` in
`packages/cli/src/block-availability.ts` implements exactly this; use its
reasoning rather than eyeballing the counts.

A historical `--sha` never has block data at all: `graphFromSnapshot` supplies
an empty block graph regardless of what is on disk. Report that as a known
limit, not a failure.

## Next

`agent-analyze-functions` and `agent-analyze-docs` — independent of each other,
both required before `agent-analyze-clusters`. See `agent-analyze-repo` for the
full chain.

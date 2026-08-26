# Group-narration pass

**Status:** open (agent-authored path shipped; automated pass not built)
**Found:** 2026-08-21 (deferred inline in the hierarchy/clustering redesign)
**Filed here:** 2026-08-25

## Problem
`group` units ship with `semantics: null`. `packages/interpreter/src/groups.ts:153-155`
sets it explicitly, with a comment recording why: synthesizing group text from
member-layer semantics "would produce text no human wrote and no model endorsed,
so groups ship unnarrated until a group-narration pass lands."

`runPassCGroups` (`packages/interpreter/src/pass-c.ts:180`) does call an LLM, but
only to propose *merges* — which layers belong in which group. It returns a
membership proposal, never a what/how/when/where/why. So after a plain
`scv analyze`, every group in the UI is a named box with no narration behind it,
while the layers inside it are fully narrated.

A second, related defect: group names have no cross-commit carry-over. An
LLM-chosen name can drift between commits even when membership is unchanged,
which reads in the Delta view as one group disappearing and another appearing.
Layers already solved this — Phase 4c gave them sticky names keyed on a stable
membership id (`docs/plans/deterministic-partition-4c.md`); groups did not get
the equivalent.

## Partially closed
PR #144 (`docs/plans/agent-analyze-groups-flows.md`) added `--with-groups`, letting
an agent author group narration and inject it into the artifact cache with zero LLM
calls, via the `agent-analyze-groups` skill. That makes narrated groups reachable,
and is the recommended path today.

It does not close this item. It is a side channel that requires an agent to run a
skill by hand; the pipeline itself is unchanged. `scv analyze` on its own still
produces `semantics: null` groups, and the name-drift problem is untouched by it —
agent-authored names drift exactly as readily.

## What closing it looks like
- A real narration pass over group units (mirroring Pass C's layer narration),
  reusing the existing provider + content cache so it is cacheable and skippable
  under `--no-llm`.
- Sticky group names keyed on a stable membership id, matching what Phase 4c did
  for layers, so an unchanged group keeps its name across commits.
- The agent-authored `--with-groups` path keeps working and keeps taking
  precedence when a pending file is present — it is the zero-cost escape hatch,
  not a thing to remove.

## Affected
- `packages/interpreter/src/groups.ts` (the `semantics: null` site)
- `packages/interpreter/src/pass-c.ts` (`runPassCGroups`, merges-only today)
- `packages/interpreter/src/orchestrate.ts` (pass sequencing)
- `docs/spec/roadmap.md` — "Future work" entry, still accurate as written

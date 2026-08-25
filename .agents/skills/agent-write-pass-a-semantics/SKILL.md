---
name: agent-write-pass-a-semantics
description: Author Pass-A-shaped semantics (what/how/when/where/why) for functions/classes you already have context on, and inject them into scv's artifact cache with zero LLM/provider calls. Use when asked to semantically annotate code without running scv's real LLM interpreter pass.
---

# Agent-authored Pass A semantics

`scv analyze --no-llm` produces a structural snapshot with real, stable unit
ids (`u:<qualname>`) but `semantics: null`. If you (the invoking agent) just
wrote or read the code in scope, you already know its what/how/when/where/why
— asking `scv` to phone out to an LLM to re-derive that is a wasted call.
This skill has you write that knowledge down directly; `scv merge-semantics`
injects it into the artifact cache as if a real Pass A had produced it.

## Procedure

1. Run `scv analyze --no-llm <root>` (or reuse an existing run) so unit ids
   are real, not guessed. Read `.scv/snapshots/<sha>.json` for the unit ids
   in your scope (a file, folder, function list, or the whole repo).
2. For each `function` or `class` unit in scope, check its `loc.files[0]`
   in the snapshot and skip it if that path is a test path (under a
   `tests?/`/`__tests__/` directory, or filename matches
   `test_*.py`/`*_test.py`/`*.test.ts(x)`/`*.spec.ts(x)`) or a generated
   path (under a `generated/`/`__generated__/` directory, or filename ends
   `_pb2.py`/`_pb.py`/`.pb.ts`/`.generated.ts`/`.g.dart`) — real Pass A
   excludes exactly these same units from narration/clustering, so this
   check is derived from the snapshot's own unit data, not a separate
   guess. Only units passing that check get an entry, keyed by their exact
   `id` from the snapshot, in the pending-semantics file:

   ```json
   {
     "meta": { "agent": "<your name>", "scope": "<description>" },
     "units": {
       "u:src.handlers.create_order": {
         "kind": "function",
         "semantics": {
           "what": "Creates a new order",
           "how": "Validates input then inserts a row",
           "when": "On order creation request",
           "where": "Order service",
           "why": "Core checkout flow",
           "confidence": 0.9
         },
         "cost": { "complexity": 3, "io": ["database"], "confidence": 0.8 },
         "tags": ["payment"]
       }
     }
   }
   ```

   `kind` must match the unit's real kind (`function` or `class`) — a
   mismatch is skipped, not merged. `semantics` fields are all required if
   present; omit the whole `semantics` key to leave a unit's existing
   semantics untouched while still setting `cost`/`tags`.

3. Save the file (e.g. `.scv/pending/<sha>/semantics.json`).
4. Run:

   ```sh
   scv merge-semantics <pending-file> [root] [--scope <id...>] [--sha <sha>]
   ```

   Omit `--scope` (or pass `all`) to merge every entry in the file; pass
   `changed` to restrict to units whose files changed vs `HEAD~1`, or
   explicit unit-id globs to restrict to a subset. `--sha` selects which
   revision to merge against (defaults to HEAD): if a persisted
   `.scv/snapshots/<sha>.json` exists for it (e.g. from a prior `--no-llm`
   run at that commit), merge runs against that structural snapshot;
   otherwise it falls back to extracting the current worktree. The command
   prints `merged N, skipped M` and warns (to stderr) about any unit id
   that didn't match current extraction or had a `kind` mismatch — those
   entries are skipped, not fatal.
5. A subsequent `scv analyze <root>` reuses the merged `functions` artifact
   as-is (its `inputHash` already matches) — no provider call happens for
   merged units. Units outside scope still compute normally on the next
   real analyze.

## Notes

- This never calls an LLM/provider — it is pure file I/O plus a
  deterministic hash/merge into `.scv/artifacts/<sha>/functions.json`.
- Re-running `merge-semantics` with an updated pending file overwrites
  previously merged entries.
- To also narrate architectural layers instead of individual units, use the
  `agent-narrate-layers` skill.

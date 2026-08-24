# Agent-authored semantics (zero-LLM-cost Pass A / Pass C)

## Context

`scv analyze --no-llm` already produces a full structural snapshot (stable
`u:<qualname>` unit ids, `semantics/cost/signature: null`) with zero LLM
calls. Separately, a coding agent (Claude, Codex, or any other agent)
writing code in that repo already implicitly knows the what/how/when/where/why
for the units it just authored or read — asking it to phone out to
claude-cli or the Anthropic API to re-derive that (as originally considered)
is a second, wasted LLM call. The goal is to let the agent write that
knowledge down as ordinary text output (no `Provider.interpret()` call
anywhere) and have it merged into the snapshot so downstream tooling
(diffing, UI, layers/groups) treats it exactly like real Pass A/C output.

Two skills:
- **Phase 1** — agent supplies Pass-A-shaped semantics for functions/classes,
  scoped to the whole repo or a subset (files/functions/folders/modules).
- **Phase 2** — agent supplies Pass-C-shaped narration for layers/groups/flows.
  (Pass B itself is already deterministic/free — no agent work needed there.)

Both phases use the same mechanism: agent writes a **pending-semantics**
JSON file keyed by unit id, then a new `scv merge-semantics` CLI command
injects it into the artifact cache. No live IPC between the agent session
and the `scv` subprocess is attempted — the process boundary (agent session
vs. `scv analyze` running as a Bash subprocess) rules that out; file-based
staging + merge is the simplest mechanism that reaches the same zero-cost
result.

Decisions locked in (all per user's picks, matching the plan's recommendations):
- Agent-authored semantics reuse `provenance.source: "llm"` — no schema
  migration to `packages/schema`'s strict `source` enum.
- A pending entry whose unit id doesn't match current extraction is
  **warned and skipped**, not a hard failure.
- Merge writes into the **artifact cache** (`.scv/artifacts/<sha>/functions.json`,
  `layers.json`), with a correctly computed `inputHash`, not directly into
  the final snapshot — preserves the existing incremental pipeline.
- Phase 2's merge runs **Pass B clustering internally** (`--with-clustering`)
  rather than exposing a separate standalone clustering CLI hook.

## Pending-semantics file format

`.scv/pending/<sha>/semantics.json`:

```json
{
  "meta": { "createdAt": "...", "agent": "...", "scope": "all|changed|<globs>" },
  "units": {
    "u:src.handlers.create_order": {
      "kind": "function",
      "semantics": { "what": "...", "how": "...", "when": "...", "where": "...", "why": "...", "confidence": 0.9 },
      "cost": { "complexity": 3, "io": ["database"], "estimate": "10ms", "confidence": 0.8 },
      "tags": ["payment"],
      "signature": { "in": [...], "out": [...], "raises": [...], "async": true }
    }
  },
  "layers": {
    "<layerIdFor(files)>": { "name": "...", "what": "...", "how": "...", "when": "...", "where": "...", "why": "...", "confidence": 0.85, "files": [...] }
  }
}
```

`groups`/`flows` follow the same per-entry shape as `layers`, keyed by
`groupIdFor(memberLayerIds)` / a flow id, added once Phase 2 needs them —
not required for the first cut.

Workflow to populate it: agent runs `scv analyze --no-llm` first (so unit
ids are real, not guessed), reads the resulting snapshot for the ids in its
scope, then writes the pending file matching those ids exactly.

## Merge mechanism — `scv merge-semantics`

```
scv merge-semantics <pending-file> [--scope all|changed|<globs>] [--with-clustering] [--sha <sha>]
```

Algorithm (`packages/cli/src/merge-semantics.ts`, new):
1. Read + Zod-validate the pending file (new `packages/schema/src/pending-semantics.ts`).
2. Load `.scv/snapshots/<sha>.json` (structural, from `--no-llm`); if absent, run extraction.
3. For each `units` entry: look up unit id in structural units.
   - Not found → warn + skip.
   - `kind` mismatch → warn + skip.
   - Outside `--scope` glob → skip silently.
   - Else: set `unit.semantics` (with `source: "llm"`), `unit.cost`, `unit.tags`,
     `unit.signature`; compute `unit.hash.semantic` via the **same**
     `semanticHashInput()` normalization used by groups today
     (`packages/schema/src/normalize.ts`) — not the separate
     `hashSemantics()` used by the live orchestrate.ts path, since that one
     includes confidence/source and isn't what downstream carry-over logic
     expects for stable identity; `provenance: { source: "llm", pass: "A" }`.
4. Compute `inputHash` for `functions` via the **same formula** as
   `computeInputHash("functions", ctx, deps)` in `packages/cli/src/artifacts.ts`
   (`hashOf(graphHash(ctx.graph), ctx.promptRev)`) — export this so merge
   doesn't duplicate it — and write `.scv/artifacts/<sha>/functions.json` as
   `{inputHash, data}`, matching `StoredArtifact<FunctionsData>`'s shape exactly
   (`ARTIFACT_SCHEMA_VERSION` must also match).
5. If `--with-clustering` and `pending.layers` present: run Pass B
   (`runPassB`/`clusterFiles`, no LLM) to get real cluster membership, match
   each pending layer's `layerIdFor(files)` against real clusters (mismatch →
   warn + skip), merge narration fields the same way, write
   `.scv/artifacts/<sha>/layers.json` with correctly computed `inputHash`
   per the `layers` case in `computeInputHash`.
6. Print a summary: merged / skipped counts.

After merge, a normal `scv analyze` (or `scv analyze --artifact groups`)
run's `ensureArtifact("functions"/"layers", ctx)` sees the merged artifact's
`inputHash` already matches and reuses it as-is — zero further LLM calls,
and `groups`/`flows` compute normally on top of the agent-authored inputs
(tolerating placeholder `"(no summary)"` text for any units outside scope,
per `runLayersPass`'s existing partial-coverage handling).

## Files to add / modify

New:
- `packages/schema/src/pending-semantics.ts` — Zod schema for the pending file.
- `packages/cli/src/merge-semantics.ts` — merge algorithm above.
- `packages/cli/test/merge-semantics.test.ts` — TDD, see Verification.
- `.agents/skills/agent-write-pass-a-semantics/SKILL.md` — Phase 1 skill:
  tells the invoking agent (Claude Code, Codex, etc.) to run
  `scv analyze --no-llm`, author semantics for files/functions in scope,
  write the pending file, then run `scv merge-semantics`.
- `.agents/skills/agent-narrate-layers/SKILL.md` — Phase 2 skill: same
  pattern, narrating clusters instead of functions, invoking
  `scv merge-semantics --with-clustering`.

Modified:
- `packages/cli/src/bin.ts` — register `merge-semantics` subcommand
  (`<pending-file> [--scope] [--with-clustering] [--sha]`).
- `packages/cli/src/artifacts.ts` — export `computeInputHash` (or a thin
  wrapper) so `merge-semantics.ts` reuses the exact same hash formula
  instead of re-deriving it (avoids the two-hash-functions drift risk
  identified during design).
- `packages/schema/src/normalize.ts` — confirm `semanticHashInput` is
  exported (it already is used by `groups.ts`); reuse directly.

No changes needed to `packages/schema/src/index.ts` (no enum migration),
`packages/interpreter/src/pass-b.ts` (already callable standalone via
`runPassB`), or `packages/interpreter/src/provider.ts` (no new Provider
implementation — the whole point is avoiding that path).

## Verification

TDD RED-GREEN-Refactor per project convention, using `fixtures/orderly`:
1. Write failing tests in `merge-semantics.test.ts` first:
   - Valid merge: 2-3 real orderly units, assert semantics/cost/tags/hash/provenance land correctly.
   - Unmatched unit id → warned + skipped, other entries still merge, exit 0.
   - `kind` mismatch → skipped.
   - `--scope <glob>` filters correctly.
   - Written `inputHash` matches `computeInputHash("functions", ...)` exactly,
     so a subsequent `ensureArtifact("functions", ctx)` call reuses it
     without recomputing (assert via a follow-up `ensureArtifact` call in
     the test, not just inspecting the file).
   - `--with-clustering`: pending layer narration merged, `layers.json`
     `inputHash` correct, layer id matches `layerIdFor(files)`.
2. Implement until green; `npm test --workspace packages/cli` and
   `npm run lint`.
3. End-to-end manual check: run `scv analyze --no-llm` on `fixtures/orderly`,
   hand-write a small pending file for 2-3 functions, run
   `scv merge-semantics`, then run a normal `scv analyze` and confirm (a) no
   LLM/provider calls happen for the merged units (check provider usage /
   call count is unaffected for those ids) and (b) `scv diff`/`scv ui`
   render the agent-authored semantics identically to real Pass A output.

# Review reconciliation: security + correctness + delivery gaps

## Context

`docs/review/codex-review.md` (security, BLOCKED) and `docs/review/project-review.md`
(product/engineering, NEEDS CHANGES) both reviewed `main` at `dc4fe57` — after the
existing plan `docs/plans/pass-a-graph-context-and-cheaper-passes.md` was written but
before any of its 8 steps were implemented. Both reviews independently rediscover two
defects already in that plan (`oneLiners` "(no summary)" bug, dropped Pass A `ports` →
`signature`) — confirms the existing plan, doesn't replace it. They also surface new
defects that plan doesn't cover: two BLOCKED-severity security holes (path traversal in
server routes, symlink-following in the extractor that can exfiltrate files to a cloud
provider), a risk-floor bypass, missing runtime validation at every I/O boundary, a
dependency CVE set, and a cluster of delivery/scale gaps (no timeouts, no
progress/resume, docs describe commands that don't exist).

This plan sequences the *new* findings only. `pass-a-graph-context-and-cheaper-passes.md`
stays the source of truth for oneLiners/ports/callers-callees/cache-key work — do not
duplicate it here; this plan's step 4 supersedes that plan's step 6 (ports/signature) by
folding it into the same PR as related schema-validation work, since both touch
`Unit.signature`'s path from Pass A to snapshot. Fix order: BLOCKED security items first
(nothing ships until these clear), then correctness bugs with silent bad output, then
reliability, then docs/delivery truth, then scale — matches both reviews' own priority
ordering (codex's blocking-vs-nonblocking split; project-review's P0/P1/P2).

## Plan

**1. Server path traversal + missing validation (BLOCKED, codex #1 and #5).**
`packages/server/src/store.ts` interpolates `sha`/`skin`/`from`/`to` into filesystem
paths with no allowlist or containment check; `app.ts`'s PUT route has no body
validation. Fix: validate `sha` against a hex-SHA regex, `skin` against a fixed known-skin
enum, resolve joined paths and assert they stay under `snapshotsDir`/`deltasDir`/
`layoutsDir` (reject on mismatch), and validate the `Layout` PUT body with a Zod schema
(finite numbers, size bounds) before writing. Also parse `SnapshotSchema`/`DeltaSchema`
(already exist in `packages/schema`) at every read in `store.ts`, not just at write time —
`readAll()` currently trusts `JSON.parse` output as `Snapshot` via cast. Test: traversal
payloads (`../`, absolute paths) in `sha`/`skin`/`from`/`to` are rejected with 400, not
500 or silent file access outside the dir.

**2. Extractor symlink containment (BLOCKED, codex #2).** `packages/extractor/src/host.ts`
and `manifest.ts` use `statSync`, which follows symlinks, so a symlinked file/dir inside
an analyzed repo can point outside the repo root; that content then gets read and — if
the Anthropic provider is selected — sent to a third party. Fix: `lstatSync` to detect
symlinks, skip them by default (matches "local-first" posture already documented in
`docs/llm-call-observability.md`), add a realpath-containment check so resolved symlink
targets outside the repo root are excluded even if not skipped outright. Test: symlinked
file and symlinked directory fixtures, assert excluded from the unit set.

**3. Risk-floor bypass (codex #4).** `packages/differ/src/diff-with-risk.ts:51` sets
`score: passD.score` directly — the documented contract (`docs/design.md:175-181`) says
Pass D may only raise the deterministic floor, never lower it. Fix: `score:
Math.max(passD.score, delta.risk.formula_floor)`. Test: Pass D mock returns a score below
`formula_floor`, assert the floor wins (existing test at
`packages/differ/test/diff-with-risk.test.ts:56-75` only asserts override, not floor
preservation — extend it).

**4. Preserve Pass A signature end-to-end (codex/project-review, supersedes existing
plan's step 6).** `pass-a.ts` parses `response.ports` and drops it; `packages/cli/src/
snapshot.ts` writes `signature: null` unconditionally. Fix: add `signature` to
`PassAResult`, populate from `response.ports`, thread through `orchestrate.ts`'s Pass A
result mapping into `unit.signature`, remove the `null` hardcode in `snapshot.ts`. Same
schema-touching change as step 1's Zod validation work — one PR.

**5. Removed-unit rollup gap (codex non-blocking, correctness).**
`packages/differ/src/diff.ts:178` computes ancestor rollups from `unitsB` whenever the
head has any units, so units removed in the diff (present only in `a`) are silently
excluded from ancestor rollups. Fix: compute rollups over the union of relevant old/new
subtrees, not `unitsB` alone. Test: a module that loses a child unit entirely — assert
the removal still contributes to the ancestor's rollup.

**6. Provider timeouts + bounded Pass D concurrency (codex non-blocking, project-review
P1).** No request timeout/cancellation on any of the three providers
(`packages/interpreter/src/providers/*.ts`) — a stalled Ollama/Anthropic call hangs
analysis indefinitely. `diff-with-risk.ts`'s `Promise.all` over Pass D calls is unbounded,
proportional to changed-module count. Fix: add a fetch `AbortSignal.timeout(...)` (or
equivalent for claude-cli's subprocess) per provider call with a sane default, surface a
typed timeout error distinct from a hard failure; reuse the existing
`mapWithConcurrency` (`orchestrate.ts`) for Pass D instead of raw `Promise.all`. Test:
mock provider that never resolves — assert the call rejects at the timeout boundary, not
hangs the test.

**7. Redact logged prompts by default (codex non-blocking).**
`packages/interpreter/src/log.ts:17-18` logs full prompts/responses at `info`, and
prompts embed repository source. Fix: default `info` to truncated/redacted content;
require an explicit `--log-level debug` (or a new opt-in flag) for full-content logging,
with a one-time warning that source will be logged verbatim.

**8. Dependency CVEs (codex #3).** `npm audit --omit=dev` reports 6 high-severity
findings under `fastify@4.29.1` (`fast-uri`, `find-my-way`). Fix requires Fastify 5
(breaking). Scope as its own PR: upgrade, run full test+build, fix breakage, re-run audit
clean. Do first among the non-blocking items if it's quick; otherwise track as a tracked
follow-up with an explicit owner/date since it's the only item here with no code-level
mitigation available short of the upgrade.

**9. Docs-to-implementation reconciliation (project-review P0/P2).** `docs/design.md`
and related docs describe `scv init`/`export`/`serve`, SPA-serving, a queue endpoint, and
SQLite-indexed storage; none exist — CLI only has `analyze`/`diff`, server is API-only
over JSON files. Fix: not a code change — either implement the documented surface or
edit the docs to state the actual supported workflow (`analyze` → `diff` → run server →
run UI dev server separately) as current, with the rest explicitly marked "planned, not
implemented." Do this after steps 1-8 land, since doc accuracy depends on what's actually
fixed vs. still-aspirational by then.

## Out of scope (explicitly deferred, per review's own reasoning)

- SQLite/indexed server storage, pagination, Canvas/WebGL large-graph rendering, UI
  search/deep-links/accessibility pass, extractor content-addressed caching,
  progress/checkpoint/resumable runs, run cost/usage telemetry, remote-provider cost
  confirmation prompt — all project-review P1/P2, real scope, no BLOCKED severity, and
  depend on measuring first per the review's own "measure, then implement" recommendation.
- LangGraph/LangSmith/OpenTelemetry — already evaluated and deferred in
  `docs/llm-call-observability.md`; nothing in either review changes that reasoning.

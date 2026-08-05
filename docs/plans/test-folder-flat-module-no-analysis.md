# Treat test folders as flat modules; skip flowchart/hierarchy analysis for tests

## Context

The codebase currently treats `tests/` exactly like production source: every file under
`tests/` gets its own module qualname (`tests.integration.test_orders`), every class/function
inside gets full hierarchy nesting, and every test function with branching gets full
control-flow block extraction (`resolveBlockGraph`) and flowchart analysis — same as a
production function. This is noise: tests don't need flowchart/hierarchy fidelity, and the
extra units/blocks/LLM labeling cost (Pass A/A-blocks/B/C all run on test functions today)
is wasted.

Desired behavior (confirmed with user): a test folder collapses to at most one module level
under `tests`/`test` — i.e. `tests/integration/test_orders.py` should not produce nested
`tests` → `tests.integration` → `tests.integration.test_orders` hierarchy; it collapses to
`tests.integration`. No flowchart/block analysis runs on test functions, and no
LLM-assisted passes (summarization, grouping, flow narration) run on test units at all.

Traced the pipeline (no existing test-detection logic anywhere in the repo — confirmed via
repo-wide grep):
- File discovery: `packages/extractor/src/host.ts:11-44` (`listFiles`/`parseRepoFiles`) —
  walks every file uniformly, only skips `SKIP_DIRS` (`__pycache__`, `.git`, `.scv`,
  `node_modules`, `dist`).
- Module qualname: `packages/extractor/src/qualname.ts:7-13` (`moduleQualname`) — converts
  full relative path to dotted qualname 1:1, no flattening logic exists.
- Hierarchy build: `packages/extractor/src/resolve.ts:73-152` (`resolveGraph`) — builds
  parent/child edges purely from `moduleQualname` + `DefFact.parentName`; every file's
  full path depth becomes hierarchy depth.
- Block/control-flow extraction: `packages/extractor/src/walk-python.ts:57` and
  `walk-typescript.ts:62` call `collectControlFlow` unconditionally for every function
  definition, inline during the AST walk — no per-file gating exists.
- Block graph resolution: `packages/extractor/src/resolve.ts:317-369`
  (`resolveBlockGraph`) — groups already-collected `BlockFact`s per function qualname; this
  is the natural place to skip test-owned functions instead of touching the two walkers.

## Plan

**1. Test-path detection helper.**
New function in `packages/extractor/src/qualname.ts` (or a new small `test-path.ts` next to
it — same directory as `moduleQualname` since it's a pure path-string utility with no other
deps): `isTestPath(relPath: string): boolean`. Detects:
- any path segment exactly `tests` or `test`, or matching `__tests__`
- filename matching `test_*.py`, `*_test.py`, `*.test.ts(x)`, `*.spec.ts(x)`

Test: table of paths → expected boolean (`tests/integration/test_orders.py` → true,
`src/orders/pricing.py` → false, `src/orders/test_helpers.py` → borderline — decide false
unless under a `tests`/`test` dir, to avoid false positives on production helper files named
similarly).

**2. Flatten test module qualnames to one level.**
`moduleQualname` itself must stay a pure 1:1 path→qualname mapping (used elsewhere, e.g.
`knownModulesOf`/import resolution) — don't change its signature. Instead add
`flattenTestQualname(qualname: string, relPath: string): string` used only at the call site
in `resolveGraph` (`resolve.ts:83`, where `modQualname` is computed) — when `isTestPath`
is true, keep the path up through one level under the first `tests`/`test` segment and drop
everything deeper: `tests/integration/test_orders.py` → module `tests.integration`;
`tests/test_rate_limiter.py` → module `tests` (no extra level exists); a hypothetical
`tests/integration/api/test_deep.py` → still `tests.integration` (third+ level collapses
into the one-level module, file distinctions within it are not preserved as separate
modules).
Test: `resolveGraph` on a fixture with `tests/integration/test_orders.py` and
`tests/unit/test_pricing.py` produces module qualnames `tests.integration` /
`tests.unit` (one flat level under `tests`), not the full 3-level nesting; functions inside
still resolve to real units (still queryable/searchable), just parented directly under the
flat module.

**3. Skip block/flowchart analysis for test functions.**
In `resolveBlockGraph` (`resolve.ts:317-369`), skip emitting a blockGraph entry when the
resolved qualname is under a test module — cheapest, single-site gate (no changes needed in
`walk-python.ts`/`walk-typescript.ts`; `collectControlFlow` still runs per-function during
the walk since it's part of the inline `collectRefs`+`collectControlFlow` pair, but its
output is simply discarded for test functions at resolution time, same pattern as the
existing branching-only filter at line 347).
Test: fixture function under `tests/` with an `if`/`else` — assert no blockGraph entry for
its qualname, even though it has decision blocks (contrast with a non-test function with
identical structure, which still gets one).

**4. Exclude test units from all LLM passes, not just blocks.**
User confirmed: no flowchart analysis AND no LLM-assisted grouping/graph passes for test
code at all (narrower than "just suppress blocks" — Pass A summarization, Pass B, Pass C
grouping/flow narration should all skip test units too). `packages/interpreter/src/orchestrate.ts`
runs `runPassA`, `runPassABlocks`, `runPassB`, `runPassC`/`runPassCGroups`/`proposeFlowEntryPoints`/`narrateFlow`
over unit lists derived from `graph.units`/`graph.blockGraph`. Add one filter at the top of
`runInterpreter` (or wherever units are first gathered into the pass-iteration lists):
exclude any `SymbolUnit` whose qualname is under a test module (reuse `isTestPath`/module-qualname
check from step 1 — a unit is a test unit if its qualname starts with the flattened test
module prefix, e.g. `tests.` or `tests.integration.`). Test units still exist in the
snapshot (found, listed, searchable) with structural fields only (name, loc, hash) — they
just never get an LLM-generated summary/label/grouping.
Test: `orchestrate.ts` test — assert `runPassA`'s provider mock is never called for a unit
under `tests.`, while a sibling non-test unit still gets a Pass A summary.

## Verification

- `npm run lint && npm test` after each step.
- Run `scv analyze` on `fixtures/orderly` (ollama, per stored guidance — never claude-cli by
  default): inspect the snapshot JSON — `tests/integration/test_orders.py` and
  `tests/test_rate_limiter.py` should resolve to flat module qualnames, and no test function
  should have a `kind: "block"` child even where the test body branches.
- TDD throughout per CLAUDE.md: failing test before implementation, each step.

## Out of scope

- Changing `SKIP_DIRS` or file discovery (`host.ts`) — test files are still parsed, just
  their hierarchy/blocks/LLM passes are treated differently downstream.
- Any change to non-test hierarchy depth or collapsing behavior.
- Removing test units from the snapshot entirely — they remain present (flat hierarchy,
  structural fields), just without flowchart/block/LLM-generated content.

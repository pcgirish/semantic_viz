# API Flow: model branching (success/failure paths) + DI/middleware steps

## Context

The API Flow view (`packages/ui/src/Flows.tsx`) always renders a single straight-line
chain of steps per route, even for handlers with obvious branches (e.g. `/auth/login`
success vs. failure). Root cause: `traceFlow()` in `packages/interpreter/src/checker.ts:103-122`
walks the call graph via `longestFrom()`, which explicitly keeps only the single longest
branch at every fan-out and discards the rest (see comment at lines 97-101). The `Unit.steps`
schema field (`packages/schema/src/index.ts:117`) is a flat `UnitId[]`, so there's nowhere to
put a second branch even if the tracer produced one.

Separately, `docs/backlog/api-flow-misses-di-middleware.md` documents that the same tracer
also misses framework-level middleware/DI (e.g. FastAPI `Depends()` on a router) because it
only follows calls made from inside the handler body, not things wired to run before it. Both
gaps live in the same Pass C step-derivation code path, so per user decision they're fixed
together in one branch/PR rather than as separate changes.

Decisions made with the user:
- One PR covering schema + tracer + orchestrate + UI + DI/middleware fix.
- Branch labels use heuristics now (not just existing `control_flow` edge `flowType`) —
  infer success/failure/error labels from try/catch and multi-return-path shapes, in addition
  to using `flowType` when a `control_flow` edge is already present.
- Existing `steps: UnitId[]` stays for backward compatibility; branching is additive.

## Design

### 1. Schema (`packages/schema/src/index.ts`)

Add a new optional field on `UnitSchema` alongside `steps`:

```ts
// kind:"api_flow" only — branch-preserving trace. Present alongside `steps` (which stays
// as the single longest path for back-compat); absent when the flow has no fan-out.
const StepBranchSchema: z.ZodType<StepBranch> = z.lazy(() =>
  z.object({
    unit: UnitId,
    label: z.string().optional(), // e.g. "success", "failure", "true", "false", "exception"
    children: z.array(StepBranchSchema).optional(),
  })
);
stepsBranching: StepBranchSchema.optional(),
```

Define `StepBranch` as a recursive TS interface exported from schema's index (needed because
`z.lazy` requires an explicit type for recursive schemas).

### 2. Tracer (`packages/interpreter/src/checker.ts`)

Keep `traceFlow`/`longestFrom` as-is (still used to populate `steps` for back-compat and as
the `flowId` hash input at `orchestrate.ts:483`). Add a new function next to it:

```ts
export const MAX_BRANCH_DEPTH = 4;
export const MAX_FAN_OUT = 3;

export function traceFlowBranching(
  entryUnitId: string,
  knownUnitIds: Set<string>,
  callEdges: CallEdge[],
  controlFlowEdges: ControlFlowEdge[],
  diEdges: CallEdge[],   // see DI/middleware section below
): StepBranch | null
```

Behavior:
- Same cycle-safety approach as `longestFrom` (per-path `visited` set).
- At each node, collect all outgoing call-graph children (not just the longest), cap to
  `MAX_FAN_OUT` (deterministic: keep first `MAX_FAN_OUT` by edge order, since call edges
  are already in source order — no need for a new tie-break scheme).
  - This is a genuinely new limit; nothing existing enforces fan-out width. `MAX_BRANCH_DEPTH`
    is analogous in spirit to depth guards elsewhere in the interpreter (e.g. cycle-safe walks)
    but is a new named constant — there's no existing constant to reuse.
- Stop recursing past `MAX_BRANCH_DEPTH` hops from the entry.
- Label each child edge:
  1. If a `control_flow` edge exists between the two corresponding block/unit ids with a
     `flowType`, use that (`"true"`/`"false"`/`"exception"`/`"loop-back"`) — map `"true"/"false"`
     to `"success"/"failure"` only when the parent block is the handler's outermost condition;
     otherwise pass the raw `flowType` through as the label.
  2. Otherwise, apply a heuristic: if the child unit is only reachable from inside a `catch`
     block (info already present in blocks/`bg.edges` built in `orchestrate.ts:250-313` — reuse
     `blockType`/`edgeType` rather than re-deriving from source text), label `"error"`. If two+
     children stem from sibling `if`/`else` blocks feeding a handler, label them by return
     path when detectable (e.g. differing HTTP status in the block's `what` semantics) — else
     leave `label` undefined rather than guessing.
- Return a single root `StepBranch` (entry node) whose `children` fan out; a linear flow (no
  branching) naturally comes out as a chain of single-child nodes — no separate "flat" case
  needed in the renderer.

Add unit tests to `packages/interpreter/test/checker.test.ts` (extending the existing
`describe("traceFlow", ...)` block with a sibling `describe("traceFlowBranching", ...)`):
- Linear chain (no fan-out) → single-child chain, matches `traceFlow` path.
- Two-way fan-out (if/else) → two labeled children.
- Fan-out beyond `MAX_FAN_OUT` → truncates deterministically.
- Depth beyond `MAX_BRANCH_DEPTH` → truncates.
- Cycle → doesn't infinite-loop (reuse existing cyclic fixture pattern from `traceFlow` tests
  at `checker.test.ts:104-108`).
- Entry not in `knownUnitIds` → returns `null` (matches `traceFlow`'s existing contract).

### 3. DI/middleware steps (same tracer pass)

Per `docs/backlog/api-flow-misses-di-middleware.md`, the tracer only follows `calls` edges
from the handler body, missing router-level `Depends()`/middleware. Fix at the same layer:

- In `orchestrate.ts`, wherever routes/entry points are extracted for Pass C (`proposeFlowEntryPoints`
  call at `orchestrate.ts:458`), extend extraction to also capture framework DI attachments —
  starting with FastAPI's `dependencies=[Depends(...)]` on `APIRouter`/route decorators — as
  synthetic `calls`-like edges from the route entry to the dependency unit, tagged so the tracer
  treats them as always-first steps (they run before the handler body).
- Concretely: add a small extractor step (likely in `packages/extractor` where router/decorator
  parsing already happens — confirm exact file via `packages/extractor/src` grep for existing
  FastAPI/route decorator handling) that emits these as a distinct edge kind or reuses `calls`
  with a marker, and thread them into `traceFlowBranching` as edges that get prepended (depth 0,
  before any handler-body children) rather than fanned out as branches.
- Test: extend fixture-based interpreter tests (or add a small synthetic fixture mirroring the
  `orderly`/`rate_limit`+`verify_token` shape from the backlog doc) to assert the resulting
  `stepsBranching` includes the DI steps ahead of the handler's own calls.
- Update `docs/backlog/api-flow-misses-di-middleware.md` status to closed once done (and fix its
  stale `packages/analyze` reference — the real module is `packages/interpreter`, per this repo's
  current package layout).

### 4. Orchestrate wiring (`packages/interpreter/src/orchestrate.ts`)

At the Pass C flow loop (`orchestrate.ts:464-516`):
- Keep `const steps = traceFlow(...)` as-is for the existing `steps` field and `flowId` hash.
- Add `const branching = traceFlowBranching(entry.unit, knownUnitIds, callEdges, controlFlowEdges, diEdges);`
  — `controlFlowEdges` is the same `blockEdges` list built at lines 300-312; `diEdges` from the
  new extractor step above.
- Set `stepsBranching: branching ?? undefined` on the pushed `api_flow` unit (alongside the
  existing `steps` field at line 493).
- No change to `flowNarrationTotal`/narration logic — narration continues to summarize off
  `stepUnits` (the linear `steps`), not the branching tree; branching is a display-layer
  addition, not a semantics-generation input, to keep LLM prompt shape unchanged.

Add/extend tests in `packages/interpreter/test/orchestrate.test.ts` with a synthetic
success/failure route fixture (e.g. a handler with a try/catch or if/else producing two
distinct downstream calls) asserting the resulting unit has both `steps` and a populated
`stepsBranching` with two labeled children.

### 5. UI rendering (`packages/ui/src/Flows.tsx`)

Current linear layout (lines 56-83) computes one X position per step and draws a straight
chain via `ConnectorLayer`. Change:
- Read `selectedFlow.stepsBranching` if present; fall back to the existing linear-from-`steps`
  path when absent (keeps old snapshots/fixtures without `stepsBranching` rendering unchanged).
- Layout: recursive column assignment — depth = column (reuse `stepX(i)` spacing logic),
  and within a column, stack sibling branches vertically using `ROW_H` spacing (new `rowY(i)`
  helper analogous to existing `stepX`), fanning out from the parent's Y and merging back only
  if children reconverge on the same unit id (simple case: no merge — parallel lanes per branch,
  each terminating independently, which matches how try/catch or if/else routes actually end).
- Connectors: extend the existing `connectorEdges` construction (lines 66-83) to walk the tree
  instead of the flat array, carrying `label` from `StepBranch.label` (e.g. "success"/"failure")
  into the connector's existing `label` field — `ConnectorLayer` already renders edge labels
  (used today for `kind: "call" | "import"`), so no new rendering primitive needed, just pass
  the branch label through instead of `edgeKind(...)`.
- Reuse `Badge`/`GraphCanvas`/`ConnectorLayer` from `@scv/design-system` as today — no new
  layout library.

Add `packages/ui/test/Flows.test.tsx` (new file, or extend if one exists — check
`packages/ui/test/` first) covering: linear flow unchanged, branching flow renders both
children with labels, deep/wide flows still render without overlap given the depth/fan-out
caps from step 2.

### 6. Docs

- `docs/design.md`: document `stepsBranching` next to the existing `steps` field description
  for Pass C / API Flow.
- `docs/backlog/api-flow-misses-di-middleware.md`: mark closed, note the fix landed alongside
  branching support, correct the stale `packages/analyze` path reference.

## Verification

- `npm test` (root) — must cover new `checker.test.ts`, `orchestrate.test.ts`, and
  `Flows.test.tsx` cases (TDD: write these red before implementing each piece, per project
  convention).
- `npm run lint`.
- Manual: `npm run dev`, load the `../eq_to_word_problem/.scv` fixture (or `orderly`, which the
  backlog doc already confirms has both a DI/middleware gap and is a real fixture), open API
  Flow, select `/auth/login`-shaped or `orderly`'s `create_order`/`get_order` route, confirm
  visible branching with success/failure (or true/false/exception) labels and DI steps
  (`rate_limit`, `verify_token`) appearing ahead of the handler body's own calls.

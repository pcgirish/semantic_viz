# Function-internal flowchart extraction (TypeScript + Python)

## Context

`soft-bubbling-valley.md`'s prior plan (architectural groups/region boxes, implemented in
PR #54) explicitly deferred function-internal flowcharts — the mockup's `create_order()`
view with decision diamonds — as out of scope, needing new AST extraction, a new
interpreter pass, the never-populated `block` unit kind, a new layout algorithm, and a new
UI view. This plan scopes that follow-up.

Confirmed by exploration:
- Extraction uses **tree-sitter** (not the TS compiler API) — `tree-sitter-typescript` and
  `tree-sitter-python`, dispatched by extension in `packages/extractor/src/host.ts`.
  `walk-typescript.ts` and `walk-python.ts` are near-identical in structure: `walkDefs()`
  finds functions/classes; `collectRefs()` is a stack-based DFS over a function body,
  stopping at nested function/class boundaries, that today only extracts `call_expression`
  nodes. Neither walker visits `if`/`for`/`while`/`try`/`return` nodes.
- `packages/schema/src/index.ts`'s `UnitKindSchema` already has `"block"` in the enum,
  unused anywhere in the codebase — a clean, reserved slot.
- The closest and most important precedent is the **Flows/V9 feature**
  (`packages/interpreter/src/pass-c.ts`, `prompts/pass-c-flows.ts`, `orchestrate.ts`
  ~lines 118-260, `checker.ts`'s `traceFlow`): LLM proposes candidate entry points →
  deterministic DFS traces the *real* call graph (never LLM-invented, longest-chain-wins on
  fan-out, per-branch visited-set for cycles) → LLM narrates the traced (real) steps →
  synthetic `kind:"api_flow"` units created with `route`/`steps`. The governing principle:
  **structure is always derived deterministically from real AST/graph data; the LLM only
  proposes/narrates on top of already-validated structure.**
- Unlike Flows (which must *infer* entry points), a function's control-flow structure is
  100% recoverable from the AST with zero ambiguity — no propose/repair step is needed for
  the structure itself. This plan is purely deterministic through Layout; the only place an
  LLM could add value is narrating branch conditions in plain language, which is deferred.
- `packages/layout/src/layout.ts`'s `buildScene()` (rank → expand → order → seed → place →
  route) is built for general call-graph layout; flowcharts have a much more constrained
  shape (single entry, structured branching, single or few exits) and need a dedicated
  algorithm, not a repurposing of `buildScene`.
- `packages/skins/tiles/src/node.ts` already varies node shape via `sides` (3/4/6/0-gon) for
  complexity; a decision diamond is a natural, consistent extension of that same mechanism.
- `packages/ui/src/App.tsx` already switches between `"current" | "delta" | "depends" |
  "flows"` view modes stored in Zustand — a `"flowchart"` mode enetered by drilling into a
  specific function is a consistent addition, not a new architecture.

## Scope: v1 control constructs

| Construct | TS node | Python node | Blocks/edges produced |
|---|---|---|---|
| if / else | `if_statement`, `else_clause` | `if_statement`, `else_clause` | decision + true/false branches + merge |
| elif chain | (nested if in else) | `elif_clause` | chained decisions |
| for loop | `for_statement` | `for_statement` | loop block, body, loop-back edge |
| while loop | `while_statement` | `while_statement` | loop block, body, loop-back edge |
| try/catch | `try_statement`+`catch_clause` | `try_statement`+`except_clause` | try block, catch block, exception edge |
| early return | `return_statement` | `return_statement` | exit block, early-return edge |
| throw/raise | `throw_statement` | `raise_statement` | exit block, exception edge |
| switch/match | `switch_statement`+`switch_case`(+`switch_default`) | `match_statement`+`case_clause` | one decision block per case test, chained (TS `switch` case-fallthrough: a case with no `break_statement` gets a `sequential` edge into the next case's block instead of to merge; Python `match` has no fallthrough, every case edges straight to merge) |

**Deferred to a later iteration** (flag, don't build): comprehensions as control flow,
`async`/`await` and generator (`yield`) specific flow, decorators as flow. Reason: each
adds real design surface (e.g. generator suspend points, await-as-branch-point)
disproportionate to v1's goal of matching the mockup's basic decision-diamond flowchart.
Add only if requested after v1 ships.

**No LLM pass in v1.** Blocks are pure AST structure, same certainty class as call edges —
adding a propose/repair step would add risk (hallucinated conditions) with no upside since
the real condition text is already recoverable verbatim from source. Branch-condition
narration in plain language is a plausible v1.1, not v1.

## Part A — Extractor: control-flow block facts

Add a `collectControlFlow()` function to both `packages/extractor/src/walk-typescript.ts`
and `packages/extractor/src/walk-python.ts`, called from `walkDefs()` alongside the
existing `collectRefs()` call, over the same function-body node, with the same
stack-based-DFS-stopping-at-nested-def-boundaries shape `collectRefs` already uses.

New fact types in `packages/extractor/src/facts.ts`:
```ts
type BlockFact = {
  kind: "block";
  file: string;
  functionQualname: string;
  blockId: string;        // stable per-function: `${blockType}:${index}` at emit time
  blockType: "entry" | "sequential" | "decision" | "loop" | "try" | "catch" | "exit" | "merge";
  startLine: number;
  endLine: number;
  condition?: string;     // decision/loop condition source text, verbatim
};
type ControlFlowEdgeFact = {
  kind: "cf_edge";
  file: string;
  functionQualname: string;
  fromBlock: string;      // blockId
  toBlock: string;        // blockId
  edgeType: "sequential" | "true" | "false" | "loop-back" | "exception";
};
```
Walk emits one `entry` block, decomposes the body into sequential/decision/loop/try blocks
per the v1 construct table, and a `merge` block wherever branches reconverge. `blockId`
only needs to be stable *within* one function's fact stream (resolver qualifies it
globally, see Part B) — increment a per-blockType counter during the single-pass walk.

Keep the two walkers' logic identical in shape; only the tree-sitter node-type names
differ, matching how `collectRefs`/`collectImports` are already kept in lockstep.

**Tests** (new `packages/extractor/test/control-flow.test.ts`, mirrored for both
languages): if/else produces decision+2 branches+merge with 3 edges; nested if produces
nested decisions with correct merge ordering; loop with an early return inside produces a
loop block, an exit block, a loop-back edge, and an early-return edge; try/catch produces
an exception edge; switch/match with 3 cases produces 3 chained decision blocks each
edging to merge (Python-style, no fallthrough); TS switch with a fallthrough case (no
`break`) produces a `sequential` edge into the next case instead of to merge; plain
sequential statements between control nodes stay one sequential block (not one block per
statement — keep block count proportional to control constructs, not statement count,
matching the mockup's granularity); re-extracting the same function twice yields identical
blockIds (determinism).

## Part B — Resolver: facts → block units in SymbolGraph

In `packages/extractor/src/resolve.ts`, after existing call/import/inherit resolution, add
a block-resolution step: for each function's `BlockFact`s, mint a globally-stable
`u:block:<hash(functionQualname + blockId)>` id per block, and record the function unit's
block children + the `ControlFlowEdgeFact`s (translated to block-unit-id pairs) on the
`SymbolGraph` output (`symbol-graph.ts`) as a new optional `blockGraph` field — kept
separate from `units`/`edges` at this stage since blocks are function-internal, not
top-level symbols, mirroring how `externals` is already its own top-level field rather than
folded into `units`.

**Tests**: extend `packages/extractor/test/extract.test.ts` — a function with control flow
gets a populated `blockGraph` entry; a function with no branching gets none (not an empty
placeholder); block ids are stable across repeated extraction; nested function defs don't
have their blocks double-counted into the outer function's block graph.

## Part C — Schema: block unit + control-flow edge kind

`packages/schema/src/index.ts`:
- `"block"` already exists in `UnitKindSchema` — no enum change needed there.
- Add `"control_flow"` to `EdgeKindSchema`.
- Add optional `flowType: z.enum(["sequential","true","false","loop-back","exception"]).optional()`
  to `EdgeSchema`, used only on `control_flow` edges (mirrors how `route`/`steps` are
  optional fields used only by `api_flow` units).
- Block units use existing `Unit` fields: `kind:"block"`, `name` (condition text for
  decision/loop blocks, block type label otherwise), `parent` = owning function's id,
  `children: []`, `loc` (block's line span), `semantics: null` (no narration in v1),
  `signature: null`. No new Unit fields required.

**Tests**: extend `packages/schema/test/validator.test.ts` — accepts a `block` unit and a
`control_flow` edge with `flowType`; existing fixture snapshots (no blocks) still parse
unchanged (backward compatibility, same pattern as the earlier `group` field addition).

## Part D — Interpreter: wire block units into the snapshot

In `packages/interpreter/src/orchestrate.ts`, after Pass A (blocks don't need layer/group
context, so this can run independent of and before Pass B/C), add a deterministic
(non-LLM) step that reads each function unit's `blockGraph` entry from the `SymbolGraph`
and pushes corresponding `block` Units and `control_flow` Edges into the snapshot's
`units`/`edges` arrays, with `parent` set to the function's unit id (so blocks show up in
that function's `children`, consistent with how nesting works everywhere else in the
schema).

**Tests**: extend `packages/interpreter/test/orchestrate.test.ts` — a function with
if/else produces block units correctly parented under it plus `control_flow` edges with
correct `flowType`s; a function with no control flow produces zero block units; full
snapshot still validates against schema.

## Part E — Layout: dedicated flowchart layout

New file `packages/layout/src/flowchart.ts`, exporting `buildFlowchartScene(blockUnits,
controlFlowEdges): Scene` — a top-to-bottom DAG layout distinct from `buildScene`:
1. **Rank**: longest-path-from-entry per block (single entry, so no ambiguity here, unlike
   the general graph's topological rank).
2. **Order**: within a rank, order branches left/right by their edge's `flowType` (true
   left, false right, or a stable left-to-right per source order) — simpler than
   `buildScene`'s crossing-minimization since flowchart fan-out is narrow and structured.
3. **Place**: decision/loop blocks get a fixed-aspect box (rendered as a diamond by the
   skin); sequential/try/catch/exit blocks get default rectangular sizing.
4. **Route**: straight/orthogonal links; carry `flowType` onto each `SceneLink` so the skin
   can label true/false/loop-back.

Add `SceneRegion`-style but block-specific fields only where `SceneNode`/`SceneLink`
already generalize (reuse `SceneNode.sides` for shape, don't add new Scene types beyond
what's needed to carry `flowType` on links).

**Tests**: new `packages/layout/test/flowchart.test.ts` — entry ranks first, exit(s) rank
last; if/else branches split into adjacent ranks and reconverge at the merge block's rank;
loop-back edges connect loop body's last block to the loop block; determinism (same
input twice → identical scene).

## Part F — Skins: decision diamond + branch-labeled links

`packages/skins/tiles/src/node.ts`: extend the existing shape-by-`sides` mechanism with a
diamond case for decision/loop blocks (condition text centered inside, reusing existing
label rendering conventions, not inventing a new label style).

`packages/skins/tiles/src/link.ts`: when a link carries `flowType`, render a small
midpoint label (`T`/`F`/loop icon) — consistent with existing link styling, not a new
visual language (same principle applied to region styling in the prior plan).

**Tests**: extend `packages/skins/tiles/test/` — decision block renders a diamond polygon;
branch link renders the correct label text.

## Part G — UI: flowchart view, entered by drilling into a function

- `packages/ui/src/store.ts`: extend `mode` to include `"flowchart"`.
- New `packages/ui/src/Flowchart.tsx`: given the focused function unit id, filters the
  snapshot's block units/edges to that function's children, builds the scene via
  `buildFlowchartScene`, and renders it through `CanvasHost`-equivalent SVG plumbing
  (reuse `tilesSkin.node`/`link`, following the same pattern `CanvasHost.tsx` already
  established for regions in the prior plan — inert boxes drawn via the skin, no new
  rendering approach invented).
- `packages/ui/src/App.tsx`: double-click on a `function`-kind tile in the existing
  Current/Delta canvas enters flowchart mode focused on that function (consistent with the
  existing double-click-to-drill interaction already used for layer/module tiles — no new
  interaction vocabulary). A function with zero extracted blocks (no branching) shows a
  simple single-block message rather than an empty canvas.

**Tests**: extend `packages/ui/test/` — double-clicking a function tile switches to
flowchart mode; `Flowchart` renders decision nodes for a function with if/else; a
leaf function with no control flow renders without error.

## Verification

1. `npm test` — RED before each part's implementation, GREEN after; full suite green at
   the end.
2. `npm run lint`, `npm run build` clean.
3. Regenerate `fixtures/orderly`'s snapshot (`analyze`) so functions with real branching
   (e.g. `create_order`-equivalent) get block units; serve it and visually confirm via
   Playwright: double-clicking a branching function opens a flowchart view with a
   recognizable decision diamond, true/false branches, and a merge point; a function with
   no branching does not crash the view; existing Current/Delta/Depends-on/Flows views are
   unaffected.

## Explicitly out of scope (this plan)

- `switch`/`match`, comprehensions-as-control-flow, `async`/generator-specific flow,
  decorators-as-flow — v1.1+ if requested.
- LLM narration of branch conditions — v1.1+, deterministic extraction ships first.
- Any change to the existing Flows (`api_flow`) feature — flowcharts are a new, separate
  per-function detail view, not a modification of the cross-function Flows feature.

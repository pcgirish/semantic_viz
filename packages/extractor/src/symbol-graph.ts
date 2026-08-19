export type SymbolUnitKind = "module" | "class" | "function";

export interface SymbolLoc {
  file: string;
  start: number;
  end: number;
}

export interface SymbolParam {
  name: string;
  type: string | null;
}

export interface SymbolAuthor {
  name: string;
  lines: number;
}

export interface SymbolMetrics {
  fanIn: number;
  fanOut: number;
  churn: number;
  commits: number;
}

export interface SymbolUnit {
  id: string;
  kind: SymbolUnitKind;
  name: string;
  qualname: string;
  lang: string;
  parent: string | null;
  children: string[];
  loc: SymbolLoc;
  sloc: number;
  params: SymbolParam[];
  returns: string | null;
  bases: string[];
  hash: { struct: string; text: string };
  metrics: SymbolMetrics;
  authors: SymbolAuthor[];
}

export type SymbolEdgeKind = "imports" | "calls" | "inherits";

export interface SymbolEdge {
  id: string;
  from: string;
  to: string;
  kind: SymbolEdgeKind;
  confidence: number;
  evidence: { file: string; line: number };
  /** "di" for a synthetic edge from a route handler to a framework-wired dependency (e.g.
   *  FastAPI `Depends()`) that runs before the handler body but is never called from it.
   *  Absent for a normal call/import/inherit edge. */
  via?: "di";
}

export interface SymbolExternal {
  id: string;
  ecosystem: string;
  name: string;
  version: string | null;
  direct: boolean;
  depth: number;
  reachedBy: string[];
}

export type BlockType = "entry" | "sequential" | "decision" | "loop" | "try" | "catch" | "exit" | "merge";
export type ControlFlowEdgeType = "sequential" | "true" | "false" | "loop-back" | "exception";

export interface SymbolBlock {
  id: string;
  blockType: BlockType;
  startLine: number;
  endLine: number;
  condition: string | null;
}

export interface SymbolControlFlowEdge {
  from: string;
  to: string;
  edgeType: ControlFlowEdgeType;
  /** True when this edge is a raise/throw exit, even if edgeType carries a branch
   *  ("true"/"false") rather than "exception" — lets a flowchart render it as a risk
   *  path (red) while still using the branch's semantic label ("invalid"/"failed"). */
  raises?: boolean;
}

export interface SymbolBlockGraph {
  blocks: SymbolBlock[];
  edges: SymbolControlFlowEdge[];
}

/** A structurally-detected HTTP route registration, e.g. `@router.post("/orders")` above a
 *  handler def — derived from RouteRegistrationFact, independent of DI wiring. Used to seed
 *  flow entry-point proposals with a deterministic signal instead of relying purely on LLM
 *  sampling (docs backlog: flow entry-point sampling variance). */
export interface SymbolRoute {
  unit: string;
  method: string;
  /** route path as written, e.g. "/orders/{order_id}"; falls back to the handler name as
   *  written when no plain string path literal could be extracted. */
  path: string;
}

export interface SymbolGraph {
  units: SymbolUnit[];
  edges: SymbolEdge[];
  externals: SymbolExternal[];
  /** function unit qualname -> its internal control-flow blocks/edges, only present for
   *  functions with actual branching (see resolveBlockGraph in resolve.ts). */
  blockGraph: Record<string, SymbolBlockGraph>;
  /** Structurally-detected route handlers (see SymbolRoute). */
  routes: SymbolRoute[];
}

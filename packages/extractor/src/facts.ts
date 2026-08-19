export interface DefFact {
  kind: "def";
  unitKind: "module" | "class" | "function";
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  parentName: string | null;
  params: { name: string; type: string | null }[];
  returns: string | null;
  bases: string[];
  text: string;
}

export interface ImportFact {
  kind: "import";
  file: string;
  line: number;
  /** Module path as written, e.g. "src.api.middleware.rate_limiter" */
  module: string;
  /** Local binding name introduced, e.g. "rate_limit" */
  binding: string;
  /** Original exported name in the source module, if different from binding (aliasing) */
  imported: string | null;
}

export interface RefFact {
  kind: "ref";
  file: string;
  line: number;
  /** enclosing def's name, for attributing the call site */
  fromFunction: string | null;
  /** the bare identifier being called/referenced */
  name: string;
}

export interface InheritFact {
  kind: "inherit";
  file: string;
  className: string;
  baseName: string;
}

export interface BlockFact {
  kind: "block";
  file: string;
  functionQualname: string;
  /** stable within one function's fact stream: `${blockType}:${index}` */
  blockId: string;
  blockType: "entry" | "sequential" | "decision" | "loop" | "try" | "catch" | "exit" | "merge";
  startLine: number;
  endLine: number;
  /** decision/loop condition source text, verbatim */
  condition?: string;
}

export interface ControlFlowEdgeFact {
  kind: "cf_edge";
  file: string;
  functionQualname: string;
  fromBlock: string;
  toBlock: string;
  edgeType: "sequential" | "true" | "false" | "loop-back" | "exception";
}

/** `<var> = APIRouter(..., dependencies=[Depends(fn), Depends(fn2(...))])` — captures the
 *  router's DI-attached dependency callee names, which run before every route registered on
 *  it but are never called from a handler body (docs/backlog/api-flow-misses-di-middleware.md). */
export interface DiRouterFact {
  kind: "di_router";
  file: string;
  line: number;
  routerVar: string;
  /** bare callee names passed to each `Depends(...)`, e.g. "rate_limit" from `Depends(rate_limit("public"))` */
  dependencies: string[];
}

/** Binds a handler to the router it's registered on, either via call-form
 *  (`router.post(path)(handler)`) or decorator-form (`@router.get(path)` above a `def`). */
export interface RouteRegistrationFact {
  kind: "route_registration";
  file: string;
  line: number;
  routerVar: string;
  /** dotted name of the handler as written, e.g. "orders.create_order.create_order" or "get_order" */
  handlerName: string;
  /** HTTP method, e.g. "post", "get" — lowercase as written. */
  method: string;
  /** route path string as written, e.g. "/orders/{order_id}"; null if not a plain string literal. */
  path: string | null;
}

export type Fact = DefFact | ImportFact | RefFact | InheritFact | BlockFact | ControlFlowEdgeFact | DiRouterFact | RouteRegistrationFact;

export interface FileFacts {
  file: string;
  lang: string;
  facts: Fact[];
}

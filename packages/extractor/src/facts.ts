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

export type Fact = DefFact | ImportFact | RefFact | InheritFact | BlockFact | ControlFlowEdgeFact;

export interface FileFacts {
  file: string;
  lang: string;
  facts: Fact[];
}

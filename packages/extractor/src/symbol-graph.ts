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
}

export type SymbolEdgeKind = "imports" | "calls" | "inherits";

export interface SymbolEdge {
  id: string;
  from: string;
  to: string;
  kind: SymbolEdgeKind;
  confidence: number;
  evidence: { file: string; line: number };
}

export interface SymbolExternal {
  id: string;
  name: string;
  version: string;
  reachedBy: string[];
}

export interface SymbolGraph {
  units: SymbolUnit[];
  edges: SymbolEdge[];
  externals: SymbolExternal[];
}

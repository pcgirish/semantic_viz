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

export type Fact = DefFact | ImportFact | RefFact | InheritFact;

export interface FileFacts {
  file: string;
  lang: string;
  facts: Fact[];
}

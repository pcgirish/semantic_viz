import type Parser from "tree-sitter";
import type { SyntaxNode } from "tree-sitter";
import type { BlockFact, ControlFlowEdgeFact, DefFact, Fact, InheritFact, RefFact } from "./facts.js";

function text(node: SyntaxNode, src: string): string {
  return src.slice(node.startIndex, node.endIndex);
}

function paramsOf(node: SyntaxNode | null, src: string): { name: string; type: string | null }[] {
  if (!node) return [];
  const out: { name: string; type: string | null }[] = [];
  for (const child of node.namedChildren) {
    if (child.type === "identifier") {
      out.push({ name: text(child, src), type: null });
    } else if (child.type === "typed_parameter") {
      const nameNode = child.namedChildren.find((c) => c.type === "identifier");
      const typeNode = child.childForFieldName("type");
      if (nameNode) out.push({ name: text(nameNode, src), type: typeNode ? text(typeNode, src) : null });
    } else if (child.type === "default_parameter" || child.type === "typed_default_parameter") {
      const nameNode = child.childForFieldName("name");
      const typeNode = child.childForFieldName("type");
      if (nameNode) out.push({ name: text(nameNode, src), type: typeNode ? text(typeNode, src) : null });
    }
  }
  return out;
}

function walkDefs(
  node: SyntaxNode,
  src: string,
  file: string,
  parentName: string | null,
  out: Fact[],
): void {
  for (const child of node.namedChildren) {
    if (child.type === "function_definition") {
      const nameNode = child.childForFieldName("name");
      const paramsNode = child.childForFieldName("parameters");
      const returnNode = child.childForFieldName("return_type");
      const bodyNode = child.childForFieldName("body");
      const name = nameNode ? text(nameNode, src) : "<anonymous>";
      const def: DefFact = {
        kind: "def",
        unitKind: "function",
        name,
        file,
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1,
        parentName,
        params: paramsOf(paramsNode, src),
        returns: returnNode ? text(returnNode, src) : null,
        bases: [],
        text: text(child, src),
      };
      out.push(def);
      collectRefs(bodyNode, src, file, name, out);
      collectControlFlow(bodyNode, src, file, name, out);
      if (bodyNode) walkDefs(bodyNode, src, file, name, out);
    } else if (child.type === "class_definition") {
      const nameNode = child.childForFieldName("name");
      const bodyNode = child.childForFieldName("body");
      const superclasses = child.childForFieldName("superclasses");
      const name = nameNode ? text(nameNode, src) : "<anonymous>";
      const bases: string[] = [];
      if (superclasses) {
        for (const c of superclasses.namedChildren) {
          if (c.type === "identifier") bases.push(text(c, src));
        }
      }
      const def: DefFact = {
        kind: "def",
        unitKind: "class",
        name,
        file,
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1,
        parentName,
        params: [],
        returns: null,
        bases,
        text: text(child, src),
      };
      out.push(def);
      for (const base of bases) {
        const inherit: InheritFact = { kind: "inherit", file, className: name, baseName: base };
        out.push(inherit);
      }
      if (bodyNode) walkDefs(bodyNode, src, file, name, out);
    } else if (child.namedChildCount > 0 && child.type !== "function_definition") {
      walkDefs(child, src, file, parentName, out);
    }
  }
}

function collectRefs(
  node: SyntaxNode | null,
  src: string,
  file: string,
  fromFunction: string,
  out: Fact[],
): void {
  if (!node) return;
  const stack: SyntaxNode[] = [node];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.type === "function_definition" && n !== node) continue;
    if (n.type === "call") {
      const fn = n.childForFieldName("function");
      if (fn) {
        let name: string | null = null;
        if (fn.type === "identifier") {
          name = text(fn, src);
        } else if (fn.type === "attribute") {
          const attr = fn.childForFieldName("attribute");
          const obj = fn.childForFieldName("object");
          if (attr && obj && obj.type === "identifier") {
            name = `${text(obj, src)}.${text(attr, src)}`;
          }
        }
        if (name) {
          const ref: RefFact = { kind: "ref", file, line: fn.startPosition.row + 1, fromFunction, name };
          out.push(ref);
        }
      }
    }
    for (const c of n.namedChildren) stack.push(c);
  }
}

/** Mirrors walk-typescript.ts's BlockBuilder in shape; only node-type names differ. */
class BlockBuilder {
  private counters = new Map<BlockFact["blockType"], number>();
  private blocks: BlockFact[] = [];
  private edges: ControlFlowEdgeFact[] = [];

  constructor(
    private file: string,
    private functionQualname: string,
    private src: string,
  ) {}

  private mint(blockType: BlockFact["blockType"], startLine: number, endLine: number, condition?: string): string {
    const n = this.counters.get(blockType) ?? 0;
    this.counters.set(blockType, n + 1);
    const blockId = `${blockType}:${n}`;
    const block: BlockFact = { kind: "block", file: this.file, functionQualname: this.functionQualname, blockId, blockType, startLine, endLine };
    if (condition !== undefined) block.condition = condition;
    this.blocks.push(block);
    return blockId;
  }

  private edge(fromBlock: string, toBlock: string, edgeType: ControlFlowEdgeFact["edgeType"]): void {
    this.edges.push({ kind: "cf_edge", file: this.file, functionQualname: this.functionQualname, fromBlock, toBlock, edgeType });
  }

  private walkStatements(stmts: SyntaxNode[], current: string, entryEdgeType: ControlFlowEdgeFact["edgeType"] = "sequential"): string | null {
    let cur: string | null = current;
    let nextEdgeType = entryEdgeType;
    let seqStart: number | null = null;
    let seqEnd = 0;

    const flushSeq = () => {
      if (seqStart === null || cur === null) return;
      const id = this.mint("sequential", seqStart, seqEnd);
      this.edge(cur, id, nextEdgeType);
      nextEdgeType = "sequential";
      cur = id;
      seqStart = null;
    };

    for (const stmt of stmts) {
      if (cur === null) break;

      if (stmt.type === "if_statement") {
        flushSeq();
        cur = this.walkIf(stmt, cur, nextEdgeType);
        nextEdgeType = "sequential";
      } else if (stmt.type === "for_statement") {
        flushSeq();
        cur = this.walkLoop(stmt, cur, nextEdgeType);
        nextEdgeType = "sequential";
      } else if (stmt.type === "while_statement") {
        flushSeq();
        cur = this.walkLoop(stmt, cur, nextEdgeType);
        nextEdgeType = "sequential";
      } else if (stmt.type === "try_statement") {
        flushSeq();
        cur = this.walkTry(stmt, cur, nextEdgeType);
        nextEdgeType = "sequential";
      } else if (stmt.type === "match_statement") {
        flushSeq();
        cur = this.walkMatch(stmt, cur, nextEdgeType);
        nextEdgeType = "sequential";
      } else if (stmt.type === "return_statement") {
        flushSeq();
        const id = this.mint("exit", stmt.startPosition.row + 1, stmt.endPosition.row + 1);
        this.edge(cur, id, nextEdgeType);
        cur = null;
      } else if (stmt.type === "raise_statement") {
        flushSeq();
        const id = this.mint("exit", stmt.startPosition.row + 1, stmt.endPosition.row + 1);
        this.edge(cur, id, "exception");
        cur = null;
      } else if (stmt.type === "break_statement" || stmt.type === "continue_statement") {
        flushSeq();
        cur = null;
      } else {
        if (seqStart === null) seqStart = stmt.startPosition.row + 1;
        seqEnd = stmt.endPosition.row + 1;
      }
    }
    flushSeq();
    return cur;
  }

  private blockStatements(blockNode: SyntaxNode | null): SyntaxNode[] {
    if (!blockNode) return [];
    return blockNode.namedChildren;
  }

  // Python's if_statement lists condition + consequence "block" + any elif_clause
  // siblings + an optional else_clause, all flat (not nested like TS's else-if chain).
  private walkIf(node: SyntaxNode, current: string, entryEdgeType: ControlFlowEdgeFact["edgeType"]): string | null {
    const condNode = node.childForFieldName("condition");
    const consequence = node.childForFieldName("consequence");
    const condition = condNode ? text(condNode, this.src) : "";
    const decisionId = this.mint("decision", node.startPosition.row + 1, node.startPosition.row + 1, condition);
    this.edge(current, decisionId, entryEdgeType);

    const trueEnd = this.walkStatements(this.blockStatements(consequence), decisionId, "true");

    const elifClauses = node.namedChildren.filter((c) => c.type === "elif_clause");
    const elseClause = node.namedChildren.find((c) => c.type === "else_clause");

    // (blockId, edgeType-to-use-when-wiring-to-merge) pairs.
    const branchEnds: Array<[string, ControlFlowEdgeFact["edgeType"]]> = [];
    if (trueEnd) branchEnds.push([trueEnd, "sequential"]);

    let prevDecision = decisionId;
    let prevEdgeType: ControlFlowEdgeFact["edgeType"] = "false";

    for (const elif of elifClauses) {
      const elifCond = elif.childForFieldName("condition");
      const elifBody = elif.childForFieldName("consequence");
      const elifCondition = elifCond ? text(elifCond, this.src) : "";
      const elifDecisionId = this.mint("decision", elif.startPosition.row + 1, elif.startPosition.row + 1, elifCondition);
      this.edge(prevDecision, elifDecisionId, prevEdgeType);
      const elifEnd = this.walkStatements(this.blockStatements(elifBody), elifDecisionId, "true");
      if (elifEnd) branchEnds.push([elifEnd, "sequential"]);
      prevDecision = elifDecisionId;
      prevEdgeType = "false";
    }

    if (elseClause) {
      const elseBody = elseClause.childForFieldName("body") ?? elseClause.namedChildren[0] ?? null;
      const elseEnd = this.walkStatements(this.blockStatements(elseBody), prevDecision, prevEdgeType);
      if (elseEnd) branchEnds.push([elseEnd, "sequential"]);
    } else {
      // no else: the last decision's implicit false edges straight to merge
      branchEnds.push([prevDecision, "false"]);
    }

    if (branchEnds.length === 0) return null;

    const mergeId = this.mint("merge", node.endPosition.row + 1, node.endPosition.row + 1);
    for (const [b, edgeType] of branchEnds) this.edge(b, mergeId, edgeType);
    return mergeId;
  }

  private walkLoop(node: SyntaxNode, current: string, entryEdgeType: ControlFlowEdgeFact["edgeType"]): string {
    const condNode = node.type === "while_statement" ? node.childForFieldName("condition") : null;
    const condition = condNode ? text(condNode, this.src) : text(node, this.src).split("\n")[0] ?? "";
    const loopId = this.mint("loop", node.startPosition.row + 1, node.startPosition.row + 1, condition);
    this.edge(current, loopId, entryEdgeType);

    const bodyNode = node.childForFieldName("body");
    const bodyEnd = this.walkStatements(this.blockStatements(bodyNode), loopId);
    if (bodyEnd) this.edge(bodyEnd, loopId, "loop-back");

    return loopId;
  }

  private walkTry(node: SyntaxNode, current: string, entryEdgeType: ControlFlowEdgeFact["edgeType"]): string | null {
    const tryBody = node.childForFieldName("body");
    const tryId = this.mint("try", node.startPosition.row + 1, node.startPosition.row + 1);
    this.edge(current, tryId, entryEdgeType);

    const exceptClauses = node.namedChildren.filter((c) => c.type === "except_clause");
    const catchEnds: (string | null)[] = [];
    for (const exceptClause of exceptClauses) {
      const catchBody = exceptClause.childForFieldName("body") ?? exceptClause.namedChildren[exceptClause.namedChildren.length - 1] ?? null;
      const catchId = this.mint("catch", exceptClause.startPosition.row + 1, exceptClause.endPosition.row + 1);
      this.edge(tryId, catchId, "exception");
      catchEnds.push(this.walkStatements(this.blockStatements(catchBody), catchId));
    }

    const tryEnd = this.walkStatements(this.blockStatements(tryBody), tryId);

    const reachable = [tryEnd, ...catchEnds].filter((b): b is string => b !== null);
    if (reachable.length === 0) return null;
    const mergeId = this.mint("merge", node.endPosition.row + 1, node.endPosition.row + 1);
    for (const b of reachable) this.edge(b, mergeId, "sequential");
    return mergeId;
  }

  // Python match has no fallthrough — every case body edges straight to merge.
  // match_statement's cases live inside a wrapping "block" node (subject, block).
  private walkMatch(node: SyntaxNode, current: string, entryEdgeType: ControlFlowEdgeFact["edgeType"]): string | null {
    const body = node.namedChildren.find((c) => c.type === "block");
    const cases = body ? body.namedChildren.filter((c) => c.type === "case_clause") : [];
    if (cases.length === 0) return current;
    const mergeId = this.mint("merge", node.endPosition.row + 1, node.endPosition.row + 1);
    let prevDecision = current;
    let prevEdgeType = entryEdgeType;

    for (const c of cases) {
      const patternNode = c.namedChildren.find((n) => n.type === "case_pattern");
      const condition = patternNode ? text(patternNode, this.src) : "case";
      const decisionId = this.mint("decision", c.startPosition.row + 1, c.endPosition.row + 1, condition);
      this.edge(prevDecision, decisionId, prevEdgeType);

      const bodyNode = c.childForFieldName("consequence");
      const caseEnd = this.walkStatements(this.blockStatements(bodyNode), decisionId, "true");
      if (caseEnd) this.edge(caseEnd, mergeId, "sequential");
      prevDecision = decisionId;
      prevEdgeType = "false";
    }
    this.edge(prevDecision, mergeId, "false");

    return mergeId;
  }

  build(): { blocks: BlockFact[]; edges: ControlFlowEdgeFact[] } {
    return { blocks: this.blocks, edges: this.edges };
  }

  mintEntry(startLine: number): string {
    return this.mint("entry", startLine, startLine);
  }

  run(stmts: SyntaxNode[], entryId: string): void {
    this.walkStatements(stmts, entryId);
  }
}

export function collectControlFlow(bodyNode: SyntaxNode | null, src: string, file: string, functionQualname: string, out: Fact[]): void {
  if (!bodyNode) return;
  const builder = new BlockBuilder(file, functionQualname, src);
  const entryId = builder.mintEntry(bodyNode.startPosition.row + 1);
  builder.run(bodyNode.namedChildren, entryId);
  const { blocks, edges } = builder.build();
  for (const b of blocks) out.push(b);
  for (const e of edges) out.push(e);
}

function collectImports(node: SyntaxNode, src: string, file: string, out: Fact[]): void {
  for (const child of node.namedChildren) {
    if (child.type === "import_statement") {
      for (const nameNode of child.namedChildren) {
        if (nameNode.type === "dotted_name") {
          const module = text(nameNode, src);
          const binding = module.split(".")[0]!;
          out.push({ kind: "import", file, line: child.startPosition.row + 1, module, binding, imported: null });
        } else if (nameNode.type === "aliased_import") {
          const nameField = nameNode.childForFieldName("name");
          const aliasField = nameNode.childForFieldName("alias");
          if (nameField && aliasField) {
            const module = text(nameField, src);
            out.push({
              kind: "import",
              file,
              line: child.startPosition.row + 1,
              module,
              binding: text(aliasField, src),
              imported: null,
            });
          }
        }
      }
    } else if (child.type === "import_from_statement") {
      const moduleNode = child.childForFieldName("module_name");
      const module = moduleNode ? text(moduleNode, src) : "";
      for (const nameNode of child.namedChildren) {
        if (nameNode === moduleNode) continue;
        if (nameNode.type === "dotted_name" || nameNode.type === "identifier") {
          const imported = text(nameNode, src);
          out.push({
            kind: "import",
            file,
            line: child.startPosition.row + 1,
            module,
            binding: imported,
            imported,
          });
        } else if (nameNode.type === "aliased_import") {
          const nameField = nameNode.childForFieldName("name");
          const aliasField = nameNode.childForFieldName("alias");
          if (nameField && aliasField) {
            out.push({
              kind: "import",
              file,
              line: child.startPosition.row + 1,
              module,
              binding: text(aliasField, src),
              imported: text(nameField, src),
            });
          }
        }
      }
    } else if (child.namedChildCount > 0 && child.type !== "function_definition" && child.type !== "class_definition") {
      collectImports(child, src, file, out);
    }
  }
}

export function walkPythonFile(tree: Parser.Tree, src: string, file: string): Fact[] {
  const out: Fact[] = [];
  const moduleDef: DefFact = {
    kind: "def",
    unitKind: "module",
    name: file,
    file,
    startLine: 1,
    endLine: tree.rootNode.endPosition.row + 1,
    parentName: null,
    params: [],
    returns: null,
    bases: [],
    text: src,
  };
  out.push(moduleDef);
  collectImports(tree.rootNode, src, file, out);
  collectRefs(tree.rootNode, src, file, file, out);
  walkDefs(tree.rootNode, src, file, null, out);
  return out;
}

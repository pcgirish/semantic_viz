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
    if (child.type === "required_parameter" || child.type === "optional_parameter") {
      const pattern = child.childForFieldName("pattern");
      const typeNode = child.childForFieldName("type");
      if (pattern) out.push({ name: text(pattern, src), type: typeNode ? text(typeNode, src) : null });
    } else if (child.type === "identifier") {
      out.push({ name: text(child, src), type: null });
    }
  }
  return out;
}

function unwrapExport(node: SyntaxNode): SyntaxNode {
  if (node.type === "export_statement") {
    const decl = node.childForFieldName("declaration");
    if (decl) return decl;
  }
  return node;
}

function walkDefs(
  node: SyntaxNode,
  src: string,
  file: string,
  parentName: string | null,
  out: Fact[],
): void {
  for (const rawChild of node.namedChildren) {
    const child = unwrapExport(rawChild);
    if (child.type === "function_declaration" || child.type === "method_definition") {
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
    } else if (child.type === "class_declaration") {
      const nameNode = child.childForFieldName("name");
      const bodyNode = child.childForFieldName("body");
      const heritage = child.namedChildren.find((c) => c.type === "class_heritage");
      const name = nameNode ? text(nameNode, src) : "<anonymous>";
      const bases: string[] = [];
      if (heritage) {
        for (const clause of heritage.namedChildren) {
          if (clause.type === "extends_clause") {
            const value = clause.childForFieldName("value");
            if (value) bases.push(text(value, src));
          }
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
    } else if (child.namedChildCount > 0) {
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
    if ((n.type === "function_declaration" || n.type === "method_definition") && n !== node) continue;
    if (n.type === "call_expression") {
      const fn = n.childForFieldName("function");
      if (fn) {
        let name: string | null = null;
        if (fn.type === "identifier") {
          name = text(fn, src);
        } else if (fn.type === "member_expression") {
          const property = fn.childForFieldName("property");
          const object = fn.childForFieldName("object");
          if (property && object && object.type === "identifier") {
            name = `${text(object, src)}.${text(property, src)}`;
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

/**
 * Builds BlockFact/ControlFlowEdgeFact for one function body. blockId only needs to be
 * stable within this function's fact stream (resolver qualifies it globally) — a
 * per-blockType counter incremented during the single-pass walk gives that.
 */
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

  /** Walks a statement list. `current`/`entryEdgeType` set up the first edge into this
   *  list (default "sequential"; branch callers pass "true"/"false"/"exception"). Returns
   *  the block id statements after this list should attach to (null if the list dead-ends,
   *  e.g. every path returns/throws), with the edge type for the *next* attach always
   *  "sequential" (branch tagging only ever applies to the first edge into a branch). */
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
      if (cur === null) break; // unreachable code after a dead end; skip

      if (stmt.type === "if_statement") {
        flushSeq();
        cur = this.walkIf(stmt, cur, nextEdgeType);
        nextEdgeType = "sequential";
      } else if (stmt.type === "for_statement" || stmt.type === "for_in_statement" || stmt.type === "for_of_statement") {
        flushSeq();
        cur = this.walkLoop(stmt, cur, nextEdgeType);
        nextEdgeType = "sequential";
      } else if (stmt.type === "while_statement" || stmt.type === "do_statement") {
        flushSeq();
        cur = this.walkLoop(stmt, cur, nextEdgeType);
        nextEdgeType = "sequential";
      } else if (stmt.type === "try_statement") {
        flushSeq();
        cur = this.walkTry(stmt, cur, nextEdgeType);
        nextEdgeType = "sequential";
      } else if (stmt.type === "switch_statement") {
        flushSeq();
        cur = this.walkSwitch(stmt, cur, nextEdgeType);
        nextEdgeType = "sequential";
      } else if (stmt.type === "return_statement") {
        flushSeq();
        const id = this.mint("exit", stmt.startPosition.row + 1, stmt.endPosition.row + 1);
        this.edge(cur, id, nextEdgeType);
        cur = null;
      } else if (stmt.type === "throw_statement") {
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

  private bodyStatements(bodyNode: SyntaxNode | null): SyntaxNode[] {
    if (!bodyNode) return [];
    return bodyNode.namedChildren;
  }

  private walkIf(node: SyntaxNode, current: string, entryEdgeType: ControlFlowEdgeFact["edgeType"]): string | null {
    const condNode = node.childForFieldName("condition");
    const consequence = node.childForFieldName("consequence");
    const alternative = node.childForFieldName("alternative");
    const condition = condNode ? text(condNode, this.src) : "";
    const decisionId = this.mint("decision", node.startPosition.row + 1, node.startPosition.row + 1, condition);
    this.edge(current, decisionId, entryEdgeType);

    const trueEnd = this.walkStatements(this.bodyStatements(consequence), decisionId, "true");

    let falseEnd: string | null;
    let falseIsDirectDecision = false;
    if (alternative) {
      const altInner = alternative.namedChildren[0];
      if (altInner && altInner.type === "if_statement") {
        falseEnd = this.walkIf(altInner, decisionId, "false");
      } else {
        falseEnd = this.walkStatements(this.bodyStatements(altInner ?? alternative), decisionId, "false");
      }
    } else {
      falseEnd = decisionId;
      falseIsDirectDecision = true;
    }

    if (trueEnd === null && falseEnd === null) return null;

    const mergeId = this.mint("merge", node.endPosition.row + 1, node.endPosition.row + 1);
    if (trueEnd) this.edge(trueEnd, mergeId, "sequential");
    if (falseEnd) this.edge(falseEnd, mergeId, falseIsDirectDecision ? "false" : "sequential");
    return mergeId;
  }

  private walkLoop(node: SyntaxNode, current: string, entryEdgeType: ControlFlowEdgeFact["edgeType"]): string {
    const condNode = node.childForFieldName("condition");
    const condition = condNode ? text(condNode, this.src) : "";
    const loopId = this.mint("loop", node.startPosition.row + 1, node.startPosition.row + 1, condition);
    this.edge(current, loopId, entryEdgeType);

    const bodyNode = node.childForFieldName("body");
    const bodyEnd = this.walkStatements(this.bodyStatements(bodyNode), loopId);
    if (bodyEnd) this.edge(bodyEnd, loopId, "loop-back");

    return loopId;
  }

  private walkTry(node: SyntaxNode, current: string, entryEdgeType: ControlFlowEdgeFact["edgeType"]): string | null {
    const tryBody = node.childForFieldName("body");
    const tryId = this.mint("try", node.startPosition.row + 1, node.startPosition.row + 1);
    this.edge(current, tryId, entryEdgeType);

    const catchClause = node.namedChildren.find((c) => c.type === "catch_clause");
    let catchEnd: string | null = null;
    if (catchClause) {
      const catchBody = catchClause.childForFieldName("body");
      const catchId = this.mint("catch", catchClause.startPosition.row + 1, catchClause.endPosition.row + 1);
      this.edge(tryId, catchId, "exception");
      catchEnd = this.walkStatements(this.bodyStatements(catchBody), catchId);
    }

    const tryEnd = this.walkStatements(this.bodyStatements(tryBody), tryId);

    if (tryEnd === null && catchEnd === null) return null;
    const mergeId = this.mint("merge", node.endPosition.row + 1, node.endPosition.row + 1);
    if (tryEnd) this.edge(tryEnd, mergeId, "sequential");
    if (catchEnd) this.edge(catchEnd, mergeId, "sequential");
    return mergeId;
  }

  private walkSwitch(node: SyntaxNode, current: string, entryEdgeType: ControlFlowEdgeFact["edgeType"]): string | null {
    const body = node.childForFieldName("body");
    const cases = body ? body.namedChildren.filter((c) => c.type === "switch_case" || c.type === "switch_default") : [];
    if (cases.length === 0) return current;
    const mergeId = this.mint("merge", node.endPosition.row + 1, node.endPosition.row + 1);
    let prevDecision = current;
    let prevEdgeType = entryEdgeType;
    let anyReachedMerge = false;
    let carriedFallthrough: string | null = null;

    for (const [i, c] of cases.entries()) {
      const valueNode = c.type === "switch_case" ? c.childForFieldName("value") : null;
      const condition = valueNode ? text(valueNode, this.src) : "default";
      const decisionId = this.mint("decision", c.startPosition.row + 1, c.endPosition.row + 1, condition);
      this.edge(prevDecision, decisionId, prevEdgeType);
      if (carriedFallthrough) {
        this.edge(carriedFallthrough, decisionId, "sequential");
        carriedFallthrough = null;
      }

      const stmts = c.namedChildren.filter((n) => n !== valueNode);
      const hasBreak = stmts.some((n) => n.type === "break_statement");
      const bodyStmts = stmts.filter((n) => n.type !== "break_statement");
      const caseEnd = this.walkStatements(bodyStmts, decisionId, "true");

      const isLast = i === cases.length - 1;
      if (caseEnd) {
        if (hasBreak || isLast) {
          this.edge(caseEnd, mergeId, "sequential");
          anyReachedMerge = true;
        } else {
          carriedFallthrough = caseEnd;
        }
      }
      prevDecision = decisionId;
      prevEdgeType = "false";
    }
    if (carriedFallthrough) {
      this.edge(carriedFallthrough, mergeId, "sequential");
      anyReachedMerge = true;
    }
    // last decision's implicit "false" (no more cases matched) falls to merge
    this.edge(prevDecision, mergeId, "false");

    return anyReachedMerge || cases.length > 0 ? mergeId : null;
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
      const sourceNode = child.childForFieldName("source");
      const module = sourceNode ? text(sourceNode, src).replace(/^['"]|['"]$/g, "") : "";
      const clause = child.namedChildren.find((c) => c.type === "import_clause");
      if (clause) {
        for (const part of clause.namedChildren) {
          if (part.type === "named_imports") {
            for (const spec of part.namedChildren) {
              if (spec.type === "import_specifier") {
                const nameNode = spec.childForFieldName("name");
                const aliasNode = spec.childForFieldName("alias");
                const imported = nameNode ? text(nameNode, src) : null;
                const binding = aliasNode ? text(aliasNode, src) : imported;
                if (binding && imported) {
                  out.push({ kind: "import", file, line: child.startPosition.row + 1, module, binding, imported });
                }
              }
            }
          } else if (part.type === "namespace_import") {
            const idNode = part.namedChildren[0];
            if (idNode) {
              out.push({
                kind: "import",
                file,
                line: child.startPosition.row + 1,
                module,
                binding: text(idNode, src),
                imported: null,
              });
            }
          } else if (part.type === "identifier") {
            out.push({
              kind: "import",
              file,
              line: child.startPosition.row + 1,
              module,
              binding: text(part, src),
              imported: "default",
            });
          }
        }
      }
    } else if (child.namedChildCount > 0 && child.type !== "function_declaration" && child.type !== "class_declaration") {
      collectImports(child, src, file, out);
    }
  }
}

export function walkTypeScriptFile(tree: Parser.Tree, src: string, file: string): Fact[] {
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

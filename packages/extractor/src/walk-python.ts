import type Parser from "tree-sitter";
import type { SyntaxNode } from "tree-sitter";
import type { BlockFact, ControlFlowEdgeFact, DefFact, DiRouterFact, Fact, InheritFact, RefFact, RouteRegistrationFact } from "./facts.js";

function text(node: SyntaxNode, src: string): string {
  return src.slice(node.startIndex, node.endIndex);
}

/** Unquoted value of a Python `string` node, e.g. `"/orders"` -> `/orders`. Only handles a
 *  single plain string_content child (no f-strings/concatenation) — returns null otherwise. */
function stringLiteralValue(node: SyntaxNode, src: string): string | null {
  const content = node.namedChildren.find((c) => c.type === "string_content");
  return content ? text(content, src) : null;
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
        // Preserve the branch this raise sits on (true/false/loop-back) so a flowchart can
        // label the edge by branch outcome; only an unconditional raise is genuinely "exception".
        this.edge(cur, id, nextEdgeType === "sequential" ? "exception" : nextEdgeType);
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

/** Bare callee name of a call node's `function`, e.g. "Depends" or "rate_limit" for
 *  `Depends(rate_limit("public"))`; null for anything but a plain identifier callee. */
function calleeName(call: SyntaxNode, src: string): string | null {
  const fn = call.childForFieldName("function");
  return fn && fn.type === "identifier" ? text(fn, src) : null;
}

/** `<var> = APIRouter(..., dependencies=[Depends(fn), Depends(fn2(...))])` at any scope —
 *  captures each `Depends(...)`'s own callee (unwrapping one level of call, e.g.
 *  `rate_limit("public")` -> "rate_limit") as a dependency that runs before every route
 *  registered on `routerVar`. */
function collectDiRouters(node: SyntaxNode, src: string, file: string, out: Fact[]): void {
  const stack: SyntaxNode[] = [node];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.type === "assignment") {
      const left = n.childForFieldName("left");
      const right = n.childForFieldName("right");
      if (left?.type === "identifier" && right?.type === "call") {
        const args = right.childForFieldName("arguments");
        const depsArg = args?.namedChildren.find(
          (c) => c.type === "keyword_argument" && c.childForFieldName("name")?.type === "identifier" && text(c.childForFieldName("name")!, src) === "dependencies",
        );
        const depsList = depsArg?.childForFieldName("value");
        if (depsList?.type === "list") {
          const dependencies: string[] = [];
          for (const item of depsList.namedChildren) {
            if (item.type !== "call" || calleeName(item, src) !== "Depends") continue;
            const dependsArgs = item.childForFieldName("arguments");
            const inner = dependsArgs?.namedChildren[0];
            if (!inner) continue;
            const name = inner.type === "identifier" ? text(inner, src) : inner.type === "call" ? calleeName(inner, src) : null;
            if (name) dependencies.push(name);
          }
          if (dependencies.length > 0) {
            const fact: DiRouterFact = { kind: "di_router", file, line: n.startPosition.row + 1, routerVar: text(left, src), dependencies };
            out.push(fact);
          }
        }
      }
    }
    for (const c of n.namedChildren) stack.push(c);
  }
}

/** Dotted-name text of an expression node, e.g. "orders.create_order.create_order" for a
 *  chain of `attribute` nodes, or the bare name for a plain identifier; null otherwise. */
function dottedName(node: SyntaxNode, src: string): string | null {
  if (node.type === "identifier") return text(node, src);
  if (node.type === "attribute") {
    const obj = node.childForFieldName("object");
    const attr = node.childForFieldName("attribute");
    if (!obj || !attr) return null;
    const objName = dottedName(obj, src);
    return objName ? `${objName}.${text(attr, src)}` : null;
  }
  return null;
}

/** Binds handlers to the router they're registered on:
 *  - call-form: `router.<method>(path)(handler)` as a statement.
 *  - decorator-form: `@router.<method>(path)` immediately above a `def`. */
function collectRouteRegistrations(node: SyntaxNode, src: string, file: string, out: Fact[]): void {
  const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);
  const stack: SyntaxNode[] = [node];
  while (stack.length > 0) {
    const n = stack.pop()!;

    const registrationCallFrom = (
      decoratorLike: SyntaxNode,
    ): { routerVar: string; line: number; method: string; path: string | null } | null => {
      if (decoratorLike.type !== "call") return null;
      const fn = decoratorLike.childForFieldName("function");
      if (fn?.type !== "attribute") return null;
      const obj = fn.childForFieldName("object");
      const attr = fn.childForFieldName("attribute");
      if (obj?.type !== "identifier" || !attr || !HTTP_METHODS.has(text(attr, src))) return null;
      const pathArg = decoratorLike.childForFieldName("arguments")?.namedChildren[0];
      const path = pathArg?.type === "string" ? stringLiteralValue(pathArg, src) : null;
      return { routerVar: text(obj, src), line: decoratorLike.startPosition.row + 1, method: text(attr, src), path };
    };

    if (n.type === "call") {
      // call-form: outer call's function is itself the registration call, e.g.
      // `public.post("/orders")(handler)` — outer.function === inner registration call.
      const inner = n.childForFieldName("function");
      const reg = inner ? registrationCallFrom(inner) : null;
      if (reg) {
        const args = n.childForFieldName("arguments");
        const handlerNode = args?.namedChildren[0];
        const handlerName = handlerNode ? dottedName(handlerNode, src) : null;
        if (handlerName) {
          const fact: RouteRegistrationFact = {
            kind: "route_registration",
            file,
            line: reg.line,
            routerVar: reg.routerVar,
            handlerName,
            method: reg.method,
            path: reg.path,
          };
          out.push(fact);
        }
      }
    } else if (n.type === "decorated_definition") {
      const def = n.childForFieldName("definition");
      const fnName = def?.type === "function_definition" ? def.childForFieldName("name") : null;
      if (fnName) {
        for (const dec of n.namedChildren) {
          if (dec.type !== "decorator") continue;
          const expr = dec.namedChildren[0];
          const reg = expr ? registrationCallFrom(expr) : null;
          if (reg) {
            const fact: RouteRegistrationFact = {
              kind: "route_registration",
              file,
              line: reg.line,
              routerVar: reg.routerVar,
              handlerName: text(fnName, src),
              method: reg.method,
              path: reg.path,
            };
            out.push(fact);
          }
        }
      }
    }

    for (const c of n.namedChildren) stack.push(c);
  }
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
  collectDiRouters(tree.rootNode, src, file, out);
  collectRouteRegistrations(tree.rootNode, src, file, out);
  walkDefs(tree.rootNode, src, file, null, out);
  return out;
}

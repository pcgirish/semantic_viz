import type Parser from "tree-sitter";
import type { SyntaxNode } from "tree-sitter";
import type { DefFact, Fact, InheritFact, RefFact } from "./facts.js";

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

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

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { langForFile, parserFor } from "./grammars/registry.js";
import { walkPythonFile } from "./walk-python.js";
import { walkTypeScriptFile } from "./walk-typescript.js";
import type { FileFacts } from "./facts.js";
import { moduleQualname } from "./qualname.js";

const SKIP_DIRS = new Set(["__pycache__", ".git", ".scv", "node_modules", "dist"]);

function listFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        stack.push(full);
      } else {
        out.push(full);
      }
    }
  }
  return out.sort();
}

export function parseRepoFiles(root: string): FileFacts[] {
  const files = listFiles(root);
  const results: FileFacts[] = [];
  for (const abs of files) {
    const rel = path.relative(root, abs);
    const lang = langForFile(rel);
    if (!lang) continue;
    const src = readFileSync(abs, "utf-8");
    const parser = parserFor(lang);
    const tree = parser.parse(src);
    const facts = lang === "python" ? walkPythonFile(tree, src, rel) : walkTypeScriptFile(tree, src, rel);
    results.push({ file: rel, lang, facts });
  }
  return results;
}

export function knownModulesOf(files: FileFacts[]): Set<string> {
  return new Set(files.map((f) => moduleQualname(f.file)));
}

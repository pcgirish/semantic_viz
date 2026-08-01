import { createRequire } from "node:module";
import Parser from "tree-sitter";

// tree-sitter-python and tree-sitter-typescript both ship CJS `export =` with no
// ESM entry point; NodeNext forbids `import x = require()` in an ESM file, so
// load them via createRequire instead, consistently.
const require = createRequire(import.meta.url);
const Python = require("tree-sitter-python") as unknown;
const { typescript } = require("tree-sitter-typescript") as { typescript: unknown };

export type Lang = "python" | "typescript";

export function langForFile(rel: string): Lang | null {
  if (rel.endsWith(".py")) return "python";
  if (rel.endsWith(".ts") && !rel.endsWith(".d.ts")) return "typescript";
  return null;
}

const languageModules: Record<Lang, unknown> = {
  python: Python,
  typescript,
};

export function parserFor(lang: Lang): Parser {
  const parser = new Parser();
  parser.setLanguage(languageModules[lang] as Parser.Language);
  return parser;
}

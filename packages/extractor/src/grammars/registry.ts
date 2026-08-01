import { createRequire } from "node:module";
import Parser from "tree-sitter";

// tree-sitter-python and tree-sitter-typescript both ship CJS `export =` with no
// ESM entry point; NodeNext forbids `import x = require()` in an ESM file, so
// load them via createRequire instead, consistently.
const require = createRequire(import.meta.url);
const Python = require("tree-sitter-python") as unknown;
const { tsx } = require("tree-sitter-typescript") as { tsx: unknown };

export type Lang = "python" | "typescript" | "javascript";

export function langForFile(rel: string): Lang | null {
  if (rel.endsWith(".py")) return "python";
  if (rel.endsWith(".d.ts")) return null;
  if (rel.endsWith(".ts") || rel.endsWith(".tsx")) return "typescript";
  if (rel.endsWith(".js") || rel.endsWith(".jsx") || rel.endsWith(".mjs") || rel.endsWith(".cjs")) return "javascript";
  return null;
}

// The TSX grammar is a superset of TS+JSX and parses plain JS/JSX source
// fine, so both typescript and javascript files use it — this also lets
// .tsx and .jsx files parse JSX syntax that the plain typescript grammar
// rejects.
const languageModules: Record<Lang, unknown> = {
  python: Python,
  typescript: tsx,
  javascript: tsx,
};

export function parserFor(lang: Lang): Parser {
  const parser = new Parser();
  parser.setLanguage(languageModules[lang] as Parser.Language);
  return parser;
}

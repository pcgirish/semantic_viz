import { knownModulesOf, parseRepoFiles } from "./host.js";
import { resolveGraph } from "./resolve.js";
import type { SymbolGraph } from "./symbol-graph.js";

export function extractRepo(root: string): SymbolGraph {
  const files = parseRepoFiles(root);
  const knownModules = knownModulesOf(files);
  return resolveGraph(files, knownModules);
}

export type { SymbolEdge, SymbolExternal, SymbolGraph, SymbolUnit } from "./symbol-graph.js";

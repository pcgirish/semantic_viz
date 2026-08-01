import { knownModulesOf, parseRepoFiles } from "./host.js";
import { parseManifests } from "./manifest.js";
import { resolveGraph } from "./resolve.js";
import { churnByFile } from "./vcs.js";
import type { SymbolGraph } from "./symbol-graph.js";

export function extractRepo(root: string): SymbolGraph {
  const files = parseRepoFiles(root);
  const knownModules = knownModulesOf(files);
  const manifest = parseManifests(root);
  const churn = churnByFile(root);
  return resolveGraph(files, knownModules, manifest, churn);
}

export type { SymbolEdge, SymbolExternal, SymbolGraph, SymbolUnit } from "./symbol-graph.js";

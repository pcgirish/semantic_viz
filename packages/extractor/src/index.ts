import { knownModulesOf, parseRepoFiles } from "./host.js";
import { parseManifests } from "./manifest.js";
import { resolveGraph } from "./resolve.js";
import { churnByFile } from "./vcs.js";
import type { SymbolGraph } from "./symbol-graph.js";

export function extractRepo(root: string): SymbolGraph {
  const files = parseRepoFiles(root);
  const knownModules = knownModulesOf(files);
  const manifests = parseManifests(root);
  const churn = churnByFile(root);
  return resolveGraph(files, knownModules, manifests, churn);
}

export type { SymbolEdge, SymbolExternal, SymbolGraph, SymbolUnit, SymbolBlock, SymbolBlockGraph, BlockType } from "./symbol-graph.js";

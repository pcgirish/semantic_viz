import { knownModulesOf, parseRepoFiles } from "./host.js";
import { parseManifests } from "./manifest.js";
import { resolveGraph } from "./resolve.js";
import { churnByFile } from "./vcs.js";
import type { SymbolGraph } from "./symbol-graph.js";

export function extractRepo(root: string, cacheDir?: string): SymbolGraph {
  const files = parseRepoFiles(root, cacheDir);
  const knownModules = knownModulesOf(files);
  const manifests = parseManifests(root);
  const churn = churnByFile(root);
  return resolveGraph(files, knownModules, manifests, churn);
}

export type {
  SymbolEdge,
  SymbolExternal,
  SymbolGraph,
  SymbolUnit,
  SymbolBlock,
  SymbolBlockGraph,
  SymbolControlFlowEdge,
  ControlFlowEdgeType,
  BlockType,
  SymbolRoute,
} from "./symbol-graph.js";
export { isTestPath, isGeneratedPath } from "./qualname.js";
export { gitIgnoredPaths } from "./git-ignored.js";

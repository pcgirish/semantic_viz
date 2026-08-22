import { directoryClusters, modularity } from "./checker.js";
import type { ClusterProposal, ImportEdge } from "./checker.js";
import { assertStrictPartition, clusterFiles, type ClusterGroups } from "./cluster.js";

export interface PassBResult {
  /** Membership keyed by structural id. Not `ClusterProposal`: at this point no name exists,
   *  and naming is a strictly later step (Pass C). */
  groups: ClusterGroups;
  modularity: number;
  directoryModularity: number;
}

export interface RunPassBOptions {
  files: string[];
  edges: ImportEdge[];
}

/**
 * Pass B — clustering. No longer an LLM pass (plan 4c): it is a thin deterministic wrapper over
 * `clusterFiles`, kept as a named pipeline stage so the orchestrator's phases still read B → C.
 *
 * The provider call it used to make asked which whole *directories* to union, which meant no
 * response could ever split a directory — the answer was outside the contract's vocabulary.
 */
export function runPassB(options: RunPassBOptions): PassBResult {
  const { files, edges } = options;

  const groups = clusterFiles(files, edges);
  assertStrictPartition(groups, files);

  // `modularity` reads membership only, so it is indifferent to the key being an id rather
  // than a name — both metrics carry through unchanged, and the directory baseline stays the
  // thing the new partition is measured against.
  const byId: ClusterProposal = Object.fromEntries(groups);

  return {
    groups,
    modularity: modularity(byId, edges),
    directoryModularity: modularity(directoryClusters(files), edges),
  };
}

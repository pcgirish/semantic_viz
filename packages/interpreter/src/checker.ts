export interface ImportEdge {
  from: string;
  to: string;
  weight: number;
}

export interface CallEdge {
  from: string;
  to: string;
}

export type ClusterProposal = Record<string, string[]>;

export interface CheckedClusters {
  clusters: ClusterProposal;
  repaired: boolean;
}

const UNCLUSTERED = "unclustered";

/** Directory-shaped baseline: each file's parent directory is its cluster. */
export function directoryClusters(files: string[]): ClusterProposal {
  const clusters: ClusterProposal = {};
  for (const file of files) {
    const slash = file.lastIndexOf("/");
    const dir = slash === -1 ? "." : file.slice(0, slash);
    (clusters[dir] ??= []).push(file);
  }
  return clusters;
}

/**
 * Validates an LLM cluster proposal against the real file list and repairs it into a strict
 * partition: every real file appears in exactly one cluster, invented files are dropped, and
 * files the LLM never mentioned land in a fallback "unclustered" cluster.
 */
export function checkAndRepairClusters(proposal: ClusterProposal, files: string[]): CheckedClusters {
  const known = new Set(files);
  const seen = new Set<string>();
  const repairedClusters: ClusterProposal = {};
  let repaired = false;

  for (const [name, clusterFiles] of Object.entries(proposal)) {
    const kept: string[] = [];
    for (const file of clusterFiles) {
      if (!known.has(file)) {
        repaired = true;
        continue;
      }
      if (seen.has(file)) {
        repaired = true;
        continue;
      }
      seen.add(file);
      kept.push(file);
    }
    if (kept.length > 0) {
      repairedClusters[name] = kept;
    } else if (clusterFiles.length > 0) {
      repaired = true;
    }
  }

  const orphans = files.filter((f) => !seen.has(f));
  if (orphans.length > 0) {
    repaired = true;
    repairedClusters[UNCLUSTERED] = [...(repairedClusters[UNCLUSTERED] ?? []), ...orphans];
  }

  return { clusters: repairedClusters, repaired };
}

/**
 * Fraction of total edge weight whose endpoints fall in the same cluster — a simple, cheap
 * cohesion score used to compare a proposed clustering against the directory baseline.
 */
export function modularity(clusters: ClusterProposal, edges: ImportEdge[]): number {
  if (edges.length === 0) return 0;

  const clusterOf = new Map<string, string>();
  for (const [name, files] of Object.entries(clusters)) {
    for (const file of files) clusterOf.set(file, name);
  }

  let totalWeight = 0;
  let insideWeight = 0;
  for (const edge of edges) {
    totalWeight += edge.weight;
    if (clusterOf.get(edge.from) !== undefined && clusterOf.get(edge.from) === clusterOf.get(edge.to)) {
      insideWeight += edge.weight;
    }
  }

  return totalWeight === 0 ? 0 : insideWeight / totalWeight;
}

/**
 * Traces an api_flow's steps from a proposed entry unit by walking real `calls` edges —
 * always the single longest branch, so a conditional fan-out doesn't turn `steps` into a
 * tree. Cycle-safe via a per-branch visited set. Every hop is a validated graph edge, so
 * steps can never be hallucinated the way a raw LLM-authored path could be.
 */
export function traceFlow(entryUnitId: string, knownUnitIds: Set<string>, callEdges: CallEdge[]): string[] | null {
  if (!knownUnitIds.has(entryUnitId)) return null;

  const adjacency = new Map<string, string[]>();
  for (const edge of callEdges) {
    (adjacency.get(edge.from) ?? adjacency.set(edge.from, []).get(edge.from)!).push(edge.to);
  }

  function longestFrom(id: string, visited: Set<string>): string[] {
    const next = (adjacency.get(id) ?? []).filter((n) => !visited.has(n));
    let best: string[] = [];
    for (const n of next) {
      const path = longestFrom(n, new Set([...visited, n]));
      if (path.length > best.length) best = path;
    }
    return [id, ...best];
  }

  return longestFrom(entryUnitId, new Set([entryUnitId]));
}

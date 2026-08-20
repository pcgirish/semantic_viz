export interface ImportEdge {
  from: string;
  to: string;
  weight: number;
}

export interface CallEdge {
  from: string;
  to: string;
  /** Branch label for this hop (e.g. "success", "error", "true"), when the caller can
   *  attribute the call to a specific control-flow branch. Ignored by `traceFlow`. */
  label?: string;
}

export type ClusterProposal = Record<string, string[]>;

export interface CheckedClusters {
  clusters: ClusterProposal;
  repaired: boolean;
}

const UNCLUSTERED = "unclustered";

/** Cluster name for files sitting at the repo root — "." would render as a tile labelled ".". */
const ROOT = "root";

/**
 * Generic architecture-speak the Pass B/C prompts ban from cluster names (pass-b.ts:69). The
 * prompt is a request, not a guarantee: fixture output has shipped `api_layer`, `app_layer`,
 * and `src_layer`, so the same list is enforced here deterministically.
 */
const BANNED_NAME_TOKENS = new Set(["core", "domain", "cluster", "layer", "module", "component"]);

/** Directory-shaped baseline: each file's parent directory is its cluster. */
export function directoryClusters(files: string[]): ClusterProposal {
  const clusters: ClusterProposal = {};
  for (const file of files) {
    const slash = file.lastIndexOf("/");
    const dir = slash === -1 ? ROOT : file.slice(0, slash);
    (clusters[dir] ??= []).push(file);
  }
  return clusters;
}

/**
 * Canonicalizes one cluster name: snake_case throughout, with a trailing banned token dropped.
 * Run-to-run the same repo has produced kebab-case, snake_case, and banned suffixes for the
 * same concept, which makes group names useless as a stable identity across snapshots.
 *
 * Only a *trailing* banned token is stripped — "core_banking" is a real domain word and keeps
 * its prefix — and never the only token, since "layer" alone has nothing to fall back to.
 */
export function normalizeClusterName(name: string): string {
  const tokens = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[^A-Za-z0-9]+/)
    .filter((t) => t.length > 0)
    .map((t) => t.toLowerCase());

  if (tokens.length === 0) return name;
  if (tokens.length > 1 && BANNED_NAME_TOKENS.has(tokens[tokens.length - 1]!)) tokens.pop();
  return tokens.join("_");
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

  // Canonicalize names before the collision check below, since normalization can *create* a
  // collision ("orders_layer" -> "orders" alongside a member named "orders"). Two names that
  // normalize alike merge rather than clobber — dropping one would silently lose its files.
  const normalized: ClusterProposal = {};
  for (const [name, clusterFiles] of Object.entries(repairedClusters)) {
    const canonical = normalizeClusterName(name);
    if (canonical !== name) repaired = true;
    if (normalized[canonical]) {
      repaired = true;
      normalized[canonical] = [...normalized[canonical], ...clusterFiles];
    } else {
      normalized[canonical] = clusterFiles;
    }
  }
  for (const key of Object.keys(repairedClusters)) delete repairedClusters[key];
  Object.assign(repairedClusters, normalized);

  // A cluster name identical to one of its own members reads as that member nesting inside
  // itself once rendered as a parent/child tile (e.g. group "orders" containing layer
  // "orders" alongside unrelated layers) — rename to break the collision deterministically.
  for (const [name, clusterFiles] of Object.entries(repairedClusters)) {
    if (clusterFiles.includes(name)) {
      repaired = true;
      const renamed = `${name}_group`;
      repairedClusters[renamed] = clusterFiles;
      delete repairedClusters[name];
    }
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

export interface StepBranch {
  unit: string;
  label?: string;
  children: StepBranch[];
}

export const MAX_BRANCH_DEPTH = 4;
export const MAX_FAN_OUT = 3;

/**
 * Branch-preserving sibling of `traceFlow`: walks every outgoing `calls` edge from an entry
 * unit (not just the longest), capped at `MAX_FAN_OUT` children per node and `MAX_BRANCH_DEPTH`
 * hops deep so a conditional fan-out doesn't blow up into an unbounded tree. Cycle-safe via a
 * per-branch visited set, same as `traceFlow`. Edge `label` (e.g. "success"/"failure") is
 * carried through from the caller-supplied `CallEdge.label` when present.
 */
export function traceFlowBranching(entryUnitId: string, knownUnitIds: Set<string>, callEdges: CallEdge[]): StepBranch | null {
  if (!knownUnitIds.has(entryUnitId)) return null;

  const adjacency = new Map<string, CallEdge[]>();
  for (const edge of callEdges) {
    (adjacency.get(edge.from) ?? adjacency.set(edge.from, []).get(edge.from)!).push(edge);
  }

  function build(id: string, visited: Set<string>, depth: number): StepBranch {
    const outgoing = (adjacency.get(id) ?? []).filter((e) => !visited.has(e.to)).slice(0, MAX_FAN_OUT);
    const children = depth >= MAX_BRANCH_DEPTH ? [] : outgoing.map((e) => build(e.to, new Set([...visited, e.to]), depth + 1));
    return {
      unit: id,
      children: children.map((child, i) => (outgoing[i]?.label ? { ...child, label: outgoing[i]!.label } : child)),
    };
  }

  return build(entryUnitId, new Set([entryUnitId]), 0);
}

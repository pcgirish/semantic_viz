export type RankEdge = { from: string; to: string };

/**
 * Longest-path ranking: rank(n) = 1 + max(rank(p)) over incoming edges p -> n, else 0.
 * Computed via DFS post-order (a topological order once back-edges are dropped), then one
 * forward relaxation pass. Any edge that would close a cycle (target already on the current
 * DFS stack) is treated as a back-edge and ignored, so cyclic input still terminates.
 */
export function rank(unitIds: string[], edges: RankEdge[]): Map<string, number> {
  const idSet = new Set(unitIds);
  const adjacency = new Map<string, string[]>();
  for (const id of unitIds) adjacency.set(id, []);
  for (const e of edges) {
    if (!idSet.has(e.to) || !idSet.has(e.from)) continue;
    adjacency.get(e.from)!.push(e.to);
  }

  const incoming = new Map<string, string[]>();
  for (const id of unitIds) incoming.set(id, []);

  const onStack = new Set<string>();
  const visited = new Set<string>();
  const postOrder: string[] = [];

  function dfs(id: string): void {
    visited.add(id);
    onStack.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (onStack.has(next)) continue; // back-edge; drop it
      incoming.get(next)!.push(id);
      if (!visited.has(next)) dfs(next);
    }
    onStack.delete(id);
    postOrder.push(id);
  }

  for (const id of unitIds) {
    if (!visited.has(id)) dfs(id);
  }

  const topoOrder = [...postOrder].reverse();
  const ranks = new Map<string, number>();
  for (const id of topoOrder) {
    const parents = incoming.get(id) ?? [];
    const maxParentRank = parents.reduce((max, p) => Math.max(max, ranks.get(p) ?? 0), -1);
    ranks.set(id, maxParentRank + 1);
  }
  return ranks;
}

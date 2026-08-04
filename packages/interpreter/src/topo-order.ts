export interface CallEdgeRef {
  from: string;
  to: string;
}

/**
 * Reverse-topological order (callees before callers) via DFS post-order over `calls` edges.
 * Cycles are broken by skipping any edge back to a node already on the current DFS stack
 * (best-effort — one entry point per strongly-connected component, not a guaranteed
 * dependency-correct order within the cycle). Nodes unreachable from each other keep
 * declaration order.
 */
export function topoOrder(ids: string[], edges: CallEdgeRef[]): string[] {
  const calleesOf = new Map<string, string[]>();
  for (const edge of edges) {
    (calleesOf.get(edge.from) ?? calleesOf.set(edge.from, []).get(edge.from)!).push(edge.to);
  }

  const visited = new Set<string>();
  const onStack = new Set<string>();
  const order: string[] = [];

  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    onStack.add(id);
    for (const callee of calleesOf.get(id) ?? []) {
      if (onStack.has(callee)) continue;
      visit(callee);
    }
    onStack.delete(id);
    order.push(id);
  }

  for (const id of ids) visit(id);
  return order;
}

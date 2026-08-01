export type ExpandEdge = { from: string; to: string };

export type Chain = {
  from: string;
  to: string;
  nodes: string[]; // real endpoints + any dummy ids between them, in rank order
  back?: true; // target rank <= source rank; not expanded, excluded from adjacent-rank edges
};

export type ExpandResult = {
  unitIds: string[]; // original ids plus dummy ids, dummies appended
  edges: ExpandEdge[]; // adjacent-rank-only edges, dummy chains broken into hops
  chains: Chain[]; // one entry per input edge, for route.ts to draw the full path
  dummyRank: Map<string, number>;
};

const DUMMY_PREFIX = "~dummy~";

export function isDummy(id: string): boolean {
  return id.startsWith(DUMMY_PREFIX);
}

function dummyId(from: string, to: string, rank: number): string {
  return `${DUMMY_PREFIX}${from}|${to}|${rank}`;
}

/**
 * Breaks edges spanning more than one rank into a chain of adjacent-rank hops through
 * dummy nodes, one per intermediate rank (implement-serve.md fix #2). A dummy then
 * participates in order.ts's barycentre sweeps at every row it passes through, instead
 * of its edge cutting straight across those rows unseen by the ordering pass.
 */
export function expand(unitIds: string[], ranks: Map<string, number>, edges: ExpandEdge[]): ExpandResult {
  const dummyRank = new Map<string, number>();
  const dummyIds: string[] = [];
  const outEdges: ExpandEdge[] = [];
  const chains: Chain[] = [];

  for (const e of edges) {
    const rFrom = ranks.get(e.from) ?? 0;
    const rTo = ranks.get(e.to) ?? 0;

    if (rTo <= rFrom) {
      chains.push({ from: e.from, to: e.to, nodes: [e.from, e.to], back: true });
      continue;
    }

    if (rTo === rFrom + 1) {
      outEdges.push({ from: e.from, to: e.to });
      chains.push({ from: e.from, to: e.to, nodes: [e.from, e.to] });
      continue;
    }

    const nodes = [e.from];
    for (let r = rFrom + 1; r < rTo; r++) {
      const id = dummyId(e.from, e.to, r);
      if (!dummyRank.has(id)) {
        dummyRank.set(id, r);
        dummyIds.push(id);
      }
      nodes.push(id);
    }
    nodes.push(e.to);

    for (let i = 0; i < nodes.length - 1; i++) {
      outEdges.push({ from: nodes[i]!, to: nodes[i + 1]! });
    }
    chains.push({ from: e.from, to: e.to, nodes });
  }

  return { unitIds: [...unitIds, ...dummyIds], edges: outEdges, chains, dummyRank };
}

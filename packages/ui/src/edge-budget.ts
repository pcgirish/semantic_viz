import type { Edge, Unit } from "@scv/schema";
import { buildUnitToAncestor } from "./App.js";

/**
 * Edge visibility policy for the 2D view: how many concrete edges collapse onto one drawn
 * connector, and which connectors survive when a level has more of them than a reader can
 * follow. Kept separate from `App.tsx` because none of it is React — it is graph policy, and
 * the review's complaint ("connector density is a data-policy problem") is about exactly that.
 */

/**
 * Connectors drawn at one level before the view is denser than it is readable. Not a
 * performance limit — the SVG handles far more than this — but a legibility one: past roughly
 * this many, the reader stops tracing individual edges and the picture stops being a graph.
 * A caller with a better idea of its own level passes its own.
 */
export const DEFAULT_EDGE_BUDGET = 120;

export type BudgetResult = {
  edges: Edge[];
  /** Connectors the budget dropped. Non-zero means the view is showing a subset, and must say so. */
  elided: number;
};

/**
 * Rolls every edge up to the visible tiles containing its endpoints, merging all contributors
 * of one (from, to) pair into a single connector.
 *
 * The merge is an aggregation, not a pick. Keeping the first contributor and discarding the
 * rest — the previous behaviour — makes a connector report one leaf call's weight for what may
 * be dozens, so thickness, ranking, and the Inspector's "(n calls)" all describe an arbitrary
 * member of the bundle instead of the bundle. `rollupProvenance` records what was merged, so a
 * reader can get from the aggregate back to the concrete edges behind it.
 */
export function rollUpEdges(edges: Edge[], visibleUnits: Unit[], unitsById: Map<string, Unit>): Edge[] {
  const toVisible = buildUnitToAncestor(visibleUnits, unitsById);

  const byPair = new Map<string, { first: Edge; from: string; to: string; contributors: Edge[] }>();
  for (const e of edges) {
    const from = toVisible.get(e.from);
    const to = toVisible.get(e.to);
    if (!from || !to || from === to) continue;
    const key = `${from}->${to}`;
    const existing = byPair.get(key);
    if (existing) existing.contributors.push(e);
    else byPair.set(key, { first: e, from, to, contributors: [e] });
  }

  return [...byPair.entries()].map(([key, { first, from, to, contributors }]) => {
    const isRollup = contributors.length > 1 || from !== first.from || to !== first.to;
    const weight = contributors.reduce((sum, c) => sum + c.weight, 0);
    const merged: Edge = { ...first, id: key, from, to, weight, rollup: isRollup };

    // An aggregate is only as trustworthy as its least trustworthy contributor: one inferred
    // edge among static ones makes the connector partly inferred, and a reader deciding whether
    // to trust it needs to see that rather than the majority's confidence.
    const weakest = contributors.reduce((min, c) => (c.confidence < min.confidence ? c : min));
    merged.source = contributors.some((c) => c.source === "llm") ? "llm" : first.source;
    merged.confidence = weakest.confidence;

    if (isRollup) {
      merged.rollupProvenance = {
        edges: contributors.map((c) => c.id).sort(),
        count: contributors.length,
        weight,
      };
    } else {
      delete merged.rollupProvenance;
    }
    return merged;
  });
}

export type BudgetOptions = {
  /** Supplies each endpoint's ancestry, so an edge crossing a group boundary can outrank a
   *  heavier one inside a single group. Without it every edge ranks as internal. */
  unitsById?: Map<string, Unit>;
};

/**
 * Keeps the `limit` most informative connectors and reports how many it dropped.
 *
 * Rank, in order: crosses a group boundary, then total weight, then how many concrete edges
 * the connector stands for, then id. Cross-boundary comes first because coupling between two
 * groups is what a reviewer opened the level to find, and it is precisely what a plain weight
 * sort buries under dense within-group traffic. The id tail-break makes both the kept set and
 * its order a pure function of the edge set — never of the order it arrived in. That holds
 * below the limit too: the ranking is the output, not just the means of choosing it, and
 * route.ts assigns lane indices from it.
 */
export function applyEdgeBudget(edges: Edge[], limit: number = DEFAULT_EDGE_BUDGET, options: BudgetOptions = {}): BudgetResult {
  const groupOf = groupResolver(options.unitsById);
  const ranked = [...edges].sort((a, b) => {
    const crossing = Number(crossesBoundary(b, groupOf)) - Number(crossesBoundary(a, groupOf));
    if (crossing !== 0) return crossing;
    if (b.weight !== a.weight) return b.weight - a.weight;
    const count = (b.rollupProvenance?.count ?? 1) - (a.rollupProvenance?.count ?? 1);
    if (count !== 0) return count;
    return a.id.localeCompare(b.id);
  });

  return { edges: ranked.slice(0, limit), elided: Math.max(0, edges.length - limit) };
}

function crossesBoundary(edge: Edge, groupOf: (id: string) => string): boolean {
  const from = groupOf(edge.from);
  const to = groupOf(edge.to);
  return from !== "" && to !== "" && from !== to;
}

/** Nearest ancestor of kind "group", memoized. Returns "" when there is none, or no unit map. */
function groupResolver(unitsById?: Map<string, Unit>): (id: string) => string {
  if (!unitsById) return () => "";
  const cache = new Map<string, string>();
  return (id: string): string => {
    const hit = cache.get(id);
    if (hit !== undefined) return hit;
    cache.set(id, ""); // break cycles defensively
    let current = unitsById.get(id);
    let result = "";
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.kind === "group") {
        result = current.id;
        break;
      }
      current = current.parent ? unitsById.get(current.parent) : undefined;
    }
    cache.set(id, result);
    return result;
  };
}

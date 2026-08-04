import type { Edge, Unit } from "@scv/schema";
import type { Scene, SceneLink, SceneNode } from "./scene.js";

const NODE_W = 160;
const NODE_H = 48;
const RANK_GAP = 90;
const COL_GAP = 40;

type CfEdge = { from: string; to: string; flowType: NonNullable<Edge["flowType"]> };

/** Shape/rank-relevant type, inferred purely from each block's edges — not carried on the
 *  Unit itself (block Units only store `name`). No incoming edges = entry; a loop-back
 *  edge targets it = loop; true/false outgoing edges = decision; no outgoing edges = exit;
 *  everything else = sequential (merge points render the same as sequential — v1 has no
 *  distinct merge shape). */
function inferBlockType(id: string, edges: CfEdge[]): NonNullable<SceneNode["blockType"]> {
  const outgoing = edges.filter((e) => e.from === id);
  const incoming = edges.filter((e) => e.to === id);
  if (incoming.length === 0) return "entry";
  if (edges.some((e) => e.flowType === "loop-back" && e.to === id)) return "loop";
  const flowTypes = new Set(outgoing.map((e) => e.flowType));
  if (flowTypes.has("true") || flowTypes.has("false")) return "decision";
  if (outgoing.length === 0) return "exit";
  return "sequential";
}

/** Longest path from the entry block (single entry — the extractor always emits exactly
 *  one — so no ambiguity, unlike the general graph's topological rank). Loop-back edges
 *  are excluded from the rank walk so they don't create a cycle. */
function rankBlocks(ids: string[], edges: CfEdge[]): Map<string, number> {
  const forward = edges.filter((e) => e.flowType !== "loop-back");
  const outgoingOf = new Map<string, CfEdge[]>();
  for (const e of forward) {
    (outgoingOf.get(e.from) ?? outgoingOf.set(e.from, []).get(e.from)!).push(e);
  }
  const entry = ids.find((id) => !forward.some((e) => e.to === id)) ?? ids[0];
  const rank = new Map<string, number>();
  if (entry === undefined) return rank;
  rank.set(entry, 0);

  // BFS relax, longest-path-wins (topological order over a DAG once loop-backs are cut).
  let changed = true;
  while (changed) {
    changed = false;
    for (const [from, r] of [...rank]) {
      for (const e of outgoingOf.get(from) ?? []) {
        const candidate = r + 1;
        if ((rank.get(e.to) ?? -1) < candidate) {
          rank.set(e.to, candidate);
          changed = true;
        }
      }
    }
  }
  for (const id of ids) if (!rank.has(id)) rank.set(id, 0);
  return rank;
}

/** Merges a run of consecutive `sequential` blocks (single sequential edge in, single
 *  sequential edge out) into one node — straight-line code shouldn't render as one box
 *  per statement group. A block only collapses into its predecessor when it has exactly
 *  one incoming edge (so merge points, which fan multiple branches into one block, are
 *  never absorbed) and that edge is `sequential` (so a block reached via true/false/
 *  loop-back — a real branch target — stays a separate node). Entry/exit/decision/loop/
 *  try/catch blocks are never collapsed, only untyped "sequential" ones (per
 *  inferBlockType's edge-shape classification). Returns a new block/edge list with
 *  collapsed ids removed and edges rewired past them. */
function collapseSequentialRuns(blocks: Unit[], cfEdges: CfEdge[]): { blocks: Unit[]; edges: CfEdge[] } {
  const ids = blocks.map((b) => b.id);
  const incomingOf = new Map<string, CfEdge[]>();
  const outgoingOf = new Map<string, CfEdge[]>();
  for (const e of cfEdges) {
    (incomingOf.get(e.to) ?? incomingOf.set(e.to, []).get(e.to)!).push(e);
    (outgoingOf.get(e.from) ?? outgoingOf.set(e.from, []).get(e.from)!).push(e);
  }

  // redirectTo(id) follows collapsed-away ids to the surviving node they were merged into.
  const redirectTo = new Map<string, string>();

  for (const id of ids) {
    if (inferBlockType(id, cfEdges) !== "sequential") continue;
    const incoming = incomingOf.get(id) ?? [];
    if (incoming.length !== 1 || incoming[0]!.flowType !== "sequential") continue;
    const pred = incoming[0]!.from;
    // Only collapse into a predecessor that is itself sequential (or already collapsed
    // into a sequential run) — never absorb into entry/decision/loop/etc.
    const predRoot = redirectTo.get(pred) ?? pred;
    if (inferBlockType(predRoot, cfEdges) !== "sequential" && !redirectTo.has(pred)) continue;
    redirectTo.set(id, predRoot);
  }

  const survives = (id: string) => !redirectTo.has(id);
  const resolve = (id: string) => redirectTo.get(id) ?? id;

  const collapsedBlocks = blocks.filter((b) => survives(b.id));
  const seenEdge = new Set<string>();
  const collapsedEdges: CfEdge[] = [];
  for (const e of cfEdges) {
    const from = resolve(e.from);
    const to = resolve(e.to);
    if (from === to) continue; // internal edge within a collapsed run
    const key = `${from}>${to}>${e.flowType}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    collapsedEdges.push({ from, to, flowType: e.flowType });
  }

  return { blocks: collapsedBlocks, edges: collapsedEdges };
}

/** Composes rank -> left/right order (true left, false right, else source order) ->
 *  fixed-size placement -> straight/orthogonal routing into a flowchart-shaped Scene.
 *  Deliberately not a reuse of buildScene: flowcharts have a single entry and narrow,
 *  structured branching, so a dedicated, simpler algorithm avoids buildScene's
 *  crossing-minimization machinery built for the general call graph. */
export function buildFlowchartScene(rawBlocks: Unit[], edges: Edge[]): Scene {
  const rawCfEdges: CfEdge[] = edges
    .filter((e): e is Edge & { flowType: NonNullable<Edge["flowType"]> } => e.kind === "control_flow" && e.flowType !== undefined)
    .map((e) => ({ from: e.from, to: e.to, flowType: e.flowType }));

  const { blocks, edges: cfEdges } = collapseSequentialRuns(rawBlocks, rawCfEdges);

  const ids = blocks.map((b) => b.id);
  const ranks = rankBlocks(ids, cfEdges);

  const byRank = new Map<number, string[]>();
  for (const id of ids) {
    const r = ranks.get(id) ?? 0;
    (byRank.get(r) ?? byRank.set(r, []).get(r)!).push(id);
  }

  // Order each rank left-to-right: a "true" successor sorts left of its sibling "false"
  // successor at the same rank; otherwise stable source order.
  const trueRankOf = new Map<string, number>();
  for (const e of cfEdges) if (e.flowType === "true") trueRankOf.set(e.to, -1);
  for (const e of cfEdges) if (e.flowType === "false") trueRankOf.set(e.to, trueRankOf.has(e.to) ? trueRankOf.get(e.to)! : 1);

  for (const [, rowIds] of byRank) {
    rowIds.sort((a, b) => (trueRankOf.get(a) ?? 0) - (trueRankOf.get(b) ?? 0));
  }

  const sortedRanks = [...byRank.keys()].sort((a, b) => a - b);
  const unitById = new Map(blocks.map((b) => [b.id, b]));
  const nodes: SceneNode[] = [];

  for (const r of sortedRanks) {
    const rowIds = byRank.get(r)!;
    const rowWidth = rowIds.length * NODE_W + (rowIds.length - 1) * COL_GAP;
    const startX = -rowWidth / 2;
    rowIds.forEach((id, i) => {
      const unit = unitById.get(id)!;
      const blockType = inferBlockType(id, cfEdges);
      const isDiamond = blockType === "decision" || blockType === "loop";
      nodes.push({
        id,
        x: startX + i * (NODE_W + COL_GAP),
        y: r * (NODE_H + RANK_GAP),
        w: NODE_W,
        h: NODE_H,
        depth: 0,
        sides: 4,
        heat: 0,
        ring: false,
        name: unit.name,
        sloc: unit.loc.sloc,
        fanIn: cfEdges.filter((e) => e.to === id).length,
        fanOut: cfEdges.filter((e) => e.from === id).length,
        layer: "",
        group: "",
        complexity: 0,
        blockType,
        condition: isDiamond ? unit.name : undefined,
      });
    });
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const links: SceneLink[] = cfEdges.map((e, i) => {
    const from = nodeById.get(e.from);
    const to = nodeById.get(e.to);
    const path =
      from && to
        ? [
            { x: from.x + from.w / 2, y: from.y + from.h },
            { x: to.x + to.w / 2, y: to.y },
          ]
        : [];
    return {
      id: `cf:${i}`,
      from: e.from,
      to: e.to,
      path,
      lane: 0,
      bundle: [],
      kind: "control_flow",
      state: "current",
      flowType: e.flowType,
    };
  });

  return { nodes, links, regions: [] };
}

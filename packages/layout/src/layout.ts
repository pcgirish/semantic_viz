import type { Edge, Unit } from "@scv/schema";
import { rank } from "./rank.js";
import { expand } from "./expand.js";
import { order } from "./order.js";
import { seed } from "./seed.js";
import { place } from "./place.js";
import { route, type RouteChain } from "./route.js";
import type { Scene, SceneNode } from "./scene.js";

export type BuildSceneOptions = {
  priorScene?: Scene;
};

/** Cyclomatic complexity -> side count, per docs/serve.md#2 ("sides = complexity, with a correction"). */
function sidesFor(complexity: number | undefined): SceneNode["sides"] {
  const c = complexity ?? 1;
  if (c <= 2) return 3;
  if (c <= 5) return 4;
  if (c <= 12) return 6;
  return 0; // circle: the 13+ "look at this" bucket
}

/** Walks a unit's parent chain to the nearest ancestor with kind "layer", returning its stable id. */
function layerIdOf(u: Unit, unitMap: Map<string, Unit>): string {
  let c: Unit | undefined = u;
  while (c) {
    if (c.kind === "layer") return c.id;
    c = c.parent ? unitMap.get(c.parent) : undefined;
  }
  return "";
}

/**
 * Composes rank -> order -> seed -> place -> route into a Scene. Pure function of its
 * inputs: same units/edges/priorScene always produce the same Scene (docs/implement-serve.md
 * V2 exit criterion: pure-function tests, no DOM).
 */
export function buildScene(units: Unit[], edges: Edge[], options: BuildSceneOptions = {}): Scene {
  const unitIds = units.map((u) => u.id);
  const ranks = rank(
    unitIds,
    edges.map((e) => ({ from: e.from, to: e.to })),
  );

  const { unitIds: expandedIds, edges: expandedEdges, chains, dummyRank } = expand(
    unitIds,
    ranks,
    edges.map((e) => ({ from: e.from, to: e.to })),
  );
  const allRanks = new Map(ranks);
  for (const [id, r] of dummyRank) allRanks.set(id, r);

  const initialRows = order(expandedIds, allRanks, expandedEdges);

  const priorX = new Map<string, number>();
  if (options.priorScene) {
    for (const n of options.priorScene.nodes) priorX.set(n.id, n.x);
  }
  const rows = seed(initialRows, priorX);

  const sloc = new Map(units.map((u) => [u.id, u.loc.sloc]));
  const boxes = place(rows, sloc);

  // One route chain per input edge (not per expand.ts chain-dedup) — route.ts does its
  // own (from, to) bundling, keyed by the edge's original endpoints, not the dummy path.
  const routeChains: RouteChain[] = edges.map((e) => {
    const c = chains.find((ch) => ch.from === e.from && ch.to === e.to)!;
    return { from: c.from, to: c.to, nodes: c.nodes, id: e.id, ids: [e.id], kind: e.kind, back: c.back };
  });
  const links = route(routeChains, boxes);

  const fanOut = new Map<string, number>();
  const fanIn = new Map<string, number>();
  for (const e of edges) {
    fanOut.set(e.from, (fanOut.get(e.from) ?? 0) + 1);
    fanIn.set(e.to, (fanIn.get(e.to) ?? 0) + 1);
  }

  const unitMap = new Map(units.map((u) => [u.id, u]));

  const nodes: SceneNode[] = units
    .filter((u) => boxes.has(u.id))
    .map((u) => {
      const box = boxes.get(u.id)!;
      return {
        id: u.id,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        depth: 0,
        sides: sidesFor(u.cost?.complexity),
        heat: 0,
        ring: false,
        name: u.name,
        sloc: u.loc.sloc,
        fanOut: fanOut.get(u.id) ?? 0,
        fanIn: fanIn.get(u.id) ?? 0,
        layer: layerIdOf(u, unitMap),
        complexity: u.cost?.complexity ?? 0,
      };
    });

  return { nodes, links };
}

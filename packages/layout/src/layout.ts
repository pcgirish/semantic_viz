import type { Edge, Unit } from "@scv/schema";
import { rank } from "./rank.js";
import { expand } from "./expand.js";
import { order } from "./order.js";
import { seed } from "./seed.js";
import { place } from "./place.js";
import { route, type RouteChain } from "./route.js";
import type { Scene, SceneNode, SceneRegion } from "./scene.js";

const REGION_PAD = 20;

export type BuildSceneOptions = {
  priorScene?: Scene;
};

// Module names are the file's relative path (e.g. "packages/extractor/src/facts.ts");
// other kinds already carry a leaf symbol name. The breadcrumb supplies the folder
// context, so a tile only needs the filename.
function displayName(u: Unit): string {
  if (u.kind !== "module") return u.name;
  const parts = u.name.split("/");
  return parts[parts.length - 1] ?? u.name;
}

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

/** Walks a unit's parent chain to the nearest layer ancestor, returning that layer's group name. */
function groupOf(u: Unit, unitMap: Map<string, Unit>): string {
  let c: Unit | undefined = u;
  while (c) {
    if (c.kind === "layer") return c.group ?? "";
    c = c.parent ? unitMap.get(c.parent) : undefined;
  }
  return "";
}

/**
 * Bounding boxes, padded, for each group with 2+ member nodes — a single-node "group" is
 * visual noise. Membership counts distinct layers represented in the visible node set
 * (via each node's own layer, not the node itself), so a region reflects "how many
 * distinct layers of this group are on screen," whether those nodes are the layer tiles
 * themselves (system-level view) or a layer's member modules (drilled-in view).
 */
function regionsFor(nodes: SceneNode[], unitMap: Map<string, Unit>): SceneRegion[] {
  const byGroup = new Map<string, SceneNode[]>();
  const layersByGroup = new Map<string, Set<string>>();
  for (const n of nodes) {
    if (!n.group) continue;
    (byGroup.get(n.group) ?? byGroup.set(n.group, []).get(n.group)!).push(n);
    const u = unitMap.get(n.id);
    const layerId = u?.kind === "layer" ? u.id : n.layer;
    if (layerId) (layersByGroup.get(n.group) ?? layersByGroup.set(n.group, new Set()).get(n.group)!).add(layerId);
  }

  const regions: SceneRegion[] = [];
  for (const [group, members] of byGroup) {
    if ((layersByGroup.get(group)?.size ?? 0) < 2) continue;
    const minX = Math.min(...members.map((m) => m.x)) - REGION_PAD;
    const minY = Math.min(...members.map((m) => m.y)) - REGION_PAD;
    const maxX = Math.max(...members.map((m) => m.x + m.w)) + REGION_PAD;
    const maxY = Math.max(...members.map((m) => m.y + m.h)) + REGION_PAD;
    regions.push({ id: group, name: group, x: minX, y: minY, w: maxX - minX, h: maxY - minY });
  }
  return regions;
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
        name: displayName(u),
        sloc: u.loc.sloc,
        fanOut: fanOut.get(u.id) ?? 0,
        fanIn: fanIn.get(u.id) ?? 0,
        layer: layerIdOf(u, unitMap),
        group: groupOf(u, unitMap),
        complexity: u.cost?.complexity ?? 0,
      };
    });

  return { nodes, links, regions: regionsFor(nodes, unitMap) };
}

import type { Edge, Unit } from "@semviz/schema";
import { rank } from "./rank.js";
import { expand } from "./expand.js";
import { order } from "./order.js";
import { seed } from "./seed.js";
import { place } from "./place.js";
import { route, type RouteChain } from "./route.js";
import type { Scene, SceneNode, SceneRegion } from "./scene.js";

const REGION_PAD = 20;

/**
 * One edge crossing the focus boundary: its visible endpoint is inside the focused subtree, and
 * `external` names the outside endpoint's highest ancestor that is a sibling of the focused unit.
 * The caller does that resolution because only it knows the focus; layout only collapses and
 * places. `direction` is stated rather than derived, since the edge's own endpoints are the deep
 * leaves, not the collapsed ancestors.
 */
export type BoundaryEdge = {
  edge: Edge;
  /** Unit id of the collapsed external endpoint. */
  external: string;
  /**
   * The *visible* tile the interior endpoint rolls up to. Never empty: an edge whose interior
   * endpoint has no visible tile is filtered out before this record is built. Carried because
   * only the caller can resolve it, and the tray needs to know which tiles a sibling couples to.
   */
  interior: string;
  /** "out" = the edge leaves the focused subtree; "in" = it enters. */
  direction: "in" | "out";
};

export type BuildSceneOptions = {
  priorScene?: Scene;
  /** Edges with exactly one endpoint inside the focus. Layout ignores them; they are the
   *  product's business (the connected-siblings tray), not scene geometry. */
  boundaryEdges?: BoundaryEdge[];
  /** The units those crossing edges resolve to outside the focus. */
  externalUnits?: Unit[];
};

/**
 * Last segment of a path, for display. Both separators are recognised: a snapshot captured on
 * Windows records `\`, and a path can mix the two (git-for-windows and node's path APIs both
 * emit such forms), so neither can be assumed. Trailing separators are ignored so a directory
 * path yields the directory's own name rather than an empty string.
 *
 * Shared by the module tile/crumb labels and the toolbar's repo label — the same question
 * ("what is this path's name?") asked of a file and of a repo root.
 */
export function pathLeaf(path: string): string {
  const trimmed = path.trim().replace(/[/\\]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
}

// Module names are the file's relative path (e.g. "packages/extractor/src/facts.ts");
// other kinds already carry a leaf symbol name. The breadcrumb supplies the folder
// context, so a tile only needs the filename.
export function displayName(u: Unit): string {
  if (u.kind !== "module") return u.name;
  return pathLeaf(u.name) || u.name;
}

/** Cyclomatic complexity -> side count, per docs/serve.md#2 ("sides = complexity, with a correction"). */

/**
 * Extrusion depth reuses the sloc channel deliberately — the same quantity the 2D tile shows
 * as area, a 3D skin shows as height (docs/serve.md#2, "Extrusion depth"). Kept here so the
 * encoding stays in the layout engine and no skin recomputes it (docs/serve.md#1).
 *
 * The scale is set against the footprint, not chosen in the abstract: depth is world height
 * in the same units a tile is wide, so a unit has to come out taller than its footprint or the
 * scene reads as a plain of slabs rather than a skyline. The earlier tuning put a 40-sloc unit
 * at 28 against a 96-wide tile, which is why the first street-level look had nothing to walk
 * between (docs/plans/wave-5-checkpoint-2-wayfinding.md).
 *
 * The curve is √, matching what `place.ts` already does to tile *area* and for the same reason
 * (docs/serve.md#2, "√-scaled so a 500-line module does not erase a 20-line one"). Height had
 * kept a linear scale, which left a 2000-line file standing forty times a 50-line one — one
 * tower with the rest of the city as noise around its feet. Compression changes the curve, not
 * the encoding: sloc is still the only thing that drives height.
 *
 * `MIN_DEPTH` carries the slab constraint on its own, and is deliberately larger than
 * `MIN_DIM` (96) rather than tuned against a median. Real repositories are dominated by small
 * files — `fixtures/orderly`'s median unit is 2 sloc — so a floor below the footprint width
 * leaves most of the city as slabs no matter how the rest of the curve is shaped.
 */
const MIN_DEPTH = 120;
const DEPTH_PER_SQRT_SLOC = 22;
function depthFor(sloc: number): number {
  return MIN_DEPTH + Math.sqrt(Math.max(0, sloc)) * DEPTH_PER_SQRT_SLOC;
}

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
 * Walks a unit's parent chain to the nearest layer ancestor, then one more hop to that layer's
 * group *unit*, returning its id. The id rather than the name: a group's name is LLM-authored and
 * can change without the group's identity changing, so keying regions on it made a rename read as
 * one group vanishing and another appearing.
 */
function groupOf(u: Unit, unitMap: Map<string, Unit>): string {
  let c: Unit | undefined = u;
  while (c) {
    if (c.kind === "layer") {
      const parent = c.parent ? unitMap.get(c.parent) : undefined;
      return parent?.kind === "group" ? parent.id : "";
    }
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
    if (!n.groupId) continue;
    (byGroup.get(n.groupId) ?? byGroup.set(n.groupId, []).get(n.groupId)!).push(n);
    const u = unitMap.get(n.id);
    const layerId = u?.kind === "layer" ? u.id : n.layer;
    if (layerId) (layersByGroup.get(n.groupId) ?? layersByGroup.set(n.groupId, new Set()).get(n.groupId)!).add(layerId);
  }

  const regions: SceneRegion[] = [];
  for (const [groupId, members] of byGroup) {
    if ((layersByGroup.get(groupId)?.size ?? 0) < 2) continue;
    const minX = Math.min(...members.map((m) => m.x)) - REGION_PAD;
    const minY = Math.min(...members.map((m) => m.y)) - REGION_PAD;
    const maxX = Math.max(...members.map((m) => m.x + m.w)) + REGION_PAD;
    const maxY = Math.max(...members.map((m) => m.y + m.h)) + REGION_PAD;
    // Falls back to the id when the group unit is not in the visible set — a label is better
    // than a blank frame, and an id is what the caller would have to debug with anyway.
    const name = unitMap.get(groupId)?.name ?? groupId;
    regions.push({ id: groupId, name, x: minX, y: minY, w: maxX - minX, h: maxY - minY });
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
    return {
      from: c.from, to: c.to, nodes: c.nodes, id: e.id, ids: [e.id], kind: e.kind, back: c.back,
      weight: e.weight,
      unresolved: e.source === "llm",
    };
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
        depth: depthFor(u.loc.sloc),
        sides: sidesFor(u.cost?.complexity),
        heat: 0,
        ring: false,
        name: displayName(u),
        sloc: u.loc.sloc,
        fanOut: fanOut.get(u.id) ?? 0,
        fanIn: fanIn.get(u.id) ?? 0,
        layer: layerIdOf(u, unitMap),
        groupId: groupOf(u, unitMap),
        complexity: u.cost?.complexity ?? 0,
      };
    });

  const regions = regionsFor(nodes, unitMap);

  return { nodes, links, regions };
}

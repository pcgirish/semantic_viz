import type { Edge, Unit } from "@scv/schema";
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
  /** "out" = the edge leaves the focused subtree; "in" = it enters. */
  direction: "in" | "out";
};

export type BuildSceneOptions = {
  priorScene?: Scene;
  /**
   * Edges with exactly one endpoint inside the focus. Each collapses onto a boundary marker;
   * multiple edges to the same external unit merge into one, so the frame stays readable.
   */
  boundaryEdges?: BoundaryEdge[];
  /** The external units the markers stand for, for their display name and heat. */
  externalUnits?: Unit[];
};

/** Fixed marker footprint: a marker is a frame annotation, not a tile whose size means something. */
const MARKER_W = 96;
const MARKER_H = 48;
/** Gap between the interior's right edge and the marker column, and between stacked markers. */
const MARKER_GAP = 24;

// Module names are the file's relative path (e.g. "packages/extractor/src/facts.ts");
// other kinds already carry a leaf symbol name. The breadcrumb supplies the folder
// context, so a tile only needs the filename.
function displayName(u: Unit): string {
  if (u.kind !== "module") return u.name;
  const parts = u.name.split("/");
  return parts[parts.length - 1] ?? u.name;
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
    return { from: c.from, to: c.to, nodes: c.nodes, id: e.id, ids: [e.id], kind: e.kind, back: c.back, weight: e.weight };
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

  // Regions describe the focused subtree, so they are computed before markers are appended —
  // a marker stands for a unit outside the focus and must never widen a region around it.
  const regions = regionsFor(nodes, unitMap);
  nodes.push(...boundaryMarkers(nodes, regions, options));

  return { nodes, links, regions };
}

/**
 * Collapses the crossing edges onto one marker per external unit and places them in a column just
 * outside the interior's right edge, stacked in id order. Placement is deliberately dumb: markers
 * annotate the frame, so their arrangement must be stable across runs rather than optimal.
 */
function boundaryMarkers(interior: SceneNode[], regions: SceneRegion[], options: BuildSceneOptions): SceneNode[] {
  const crossings = options.boundaryEdges ?? [];
  if (crossings.length === 0) return [];

  const merged = new Map<string, { edgeCount: number; weight: number; inCount: number; outCount: number }>();
  for (const { edge, external, direction } of crossings) {
    const acc = merged.get(external) ?? { edgeCount: 0, weight: 0, inCount: 0, outCount: 0 };
    acc.edgeCount += 1;
    acc.weight += edge.weight;
    if (direction === "in") acc.inCount += 1;
    else acc.outCount += 1;
    merged.set(external, acc);
  }

  const externalById = new Map((options.externalUnits ?? []).map((u) => [u.id, u]));
  // Clear of both the tiles and any region padding drawn around them, so a marker never reads as
  // a member of a group it is outside of.
  const frameX =
    Math.max(
      ...interior.map((n) => n.x + n.w),
      ...regions.map((r) => r.x + r.w),
      0,
    ) + MARKER_GAP;
  const topY = Math.min(...interior.map((n) => n.y), 0);

  return [...merged.keys()].sort().map((id, index) => {
    const counts = merged.get(id)!;
    const unit = externalById.get(id);
    return {
      id,
      x: frameX,
      y: topY + index * (MARKER_H + MARKER_GAP),
      w: MARKER_W,
      h: MARKER_H,
      depth: unit ? depthFor(unit.loc.sloc) : MIN_DEPTH,
      // Markers read as plain tiles on purpose: a skin with no boundary support still renders
      // something meaningful and correctly placed.
      sides: 4,
      heat: 0,
      ring: false,
      name: unit ? displayName(unit) : id,
      sloc: unit?.loc.sloc ?? 0,
      // From the marker's own perspective: edges leaving the focus arrive at it, and vice versa.
      fanIn: counts.outCount,
      fanOut: counts.inCount,
      layer: "",
      groupId: "",
      complexity: unit?.cost?.complexity ?? 0,
      boundary: {
        edgeCount: counts.edgeCount,
        weight: counts.weight,
        direction: counts.inCount > 0 && counts.outCount > 0 ? "both" : counts.inCount > 0 ? "in" : "out",
        inCount: counts.inCount,
        outCount: counts.outCount,
      },
    };
  });
}

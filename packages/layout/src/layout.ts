import type { Edge, Unit } from "@scv/schema";
import { rank } from "./rank.js";
import { order } from "./order.js";
import { seed } from "./seed.js";
import { place } from "./place.js";
import { route } from "./route.js";
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

  const initialRows = order(
    unitIds,
    ranks,
    edges.map((e) => ({ from: e.from, to: e.to })),
  );

  const priorX = new Map<string, number>();
  if (options.priorScene) {
    for (const n of options.priorScene.nodes) priorX.set(n.id, n.x);
  }
  const rows = seed(initialRows, priorX);

  const sloc = new Map(units.map((u) => [u.id, u.loc.sloc]));
  const boxes = place(rows, sloc);

  const links = route(
    edges.map((e) => ({ id: e.id, from: e.from, to: e.to, kind: e.kind })),
    boxes,
  );

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
      };
    });

  return { nodes, links };
}

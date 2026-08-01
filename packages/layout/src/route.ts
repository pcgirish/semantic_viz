import type { Box } from "./place.js";
import type { SceneLink } from "./scene.js";

export type RouteEdge = { id: string; from: string; to: string; kind: string };

function centre(box: Box): { x: number; y: number } {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/**
 * Bundles edges sharing a (from-box, to-box) pair into one link (docs/serve.md#3, "bundling"),
 * then assigns each bundle a lane via a left-to-right sweep over target x so parallel edges
 * out of the same box never share a y (docs/serve.md#3, "lane assignment").
 */
export function route(edges: RouteEdge[], boxes: Map<string, Box>): SceneLink[] {
  const valid = edges.filter((e) => boxes.has(e.from) && boxes.has(e.to));

  const bundles = new Map<string, { from: string; to: string; kind: string; ids: string[] }>();
  for (const e of valid) {
    const key = `${e.from}->${e.to}`;
    const existing = bundles.get(key);
    if (existing) {
      existing.ids.push(e.id);
    } else {
      bundles.set(key, { from: e.from, to: e.to, kind: e.kind, ids: [e.id] });
    }
  }

  const bundleList = [...bundles.values()];
  // Two-pass lane assignment: sort by target x first (index), then the caller distributes
  // y across the channel's lane count once it's known (implement-serve.md fix #4).
  const sorted = bundleList
    .map((b) => ({ b, targetX: centre(boxes.get(b.to)!).x }))
    .sort((a, b2) => a.targetX - b2.targetX || a.b.from.localeCompare(b2.b.from));

  return sorted.map(({ b }, lane) => {
    const from = centre(boxes.get(b.from)!);
    const to = centre(boxes.get(b.to)!);
    return {
      id: b.ids[0]!,
      from: b.from,
      to: b.to,
      path: [from, to],
      lane,
      bundle: b.ids,
      kind: b.kind,
      state: "current",
    };
  });
}

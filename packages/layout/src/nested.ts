import type { Edge, Unit } from "@semviz/schema";
import { buildScene } from "./layout.js";
import type { Scene } from "./scene.js";
import type { Box } from "./place.js";

// Below this, a scaled child box is unreadable; fall back to a count (docs/serve.md#2).
const LEGIBILITY_FLOOR = 8;

/**
 * True nested mini-map: children laid out with the real layout engine, then scaled
 * uniformly to fit the parent's box, so the interior of a collapsed module is a faithful
 * thumbnail of what opening it shows (docs/serve.md#2, "Nested children"). Returns null
 * when there's nothing to show or the parent box is too small to be legible — the caller
 * renders a child count instead.
 */
export function nestedScene(children: Unit[], edges: Edge[], parentBox: Box): Scene | null {
  if (children.length === 0) return null;
  if (parentBox.w < LEGIBILITY_FLOOR || parentBox.h < LEGIBILITY_FLOOR) return null;

  const sub = buildScene(children, edges);
  if (sub.nodes.length === 0) return null;

  const minX = Math.min(...sub.nodes.map((n) => n.x));
  const maxX = Math.max(...sub.nodes.map((n) => n.x + n.w));
  const minY = Math.min(...sub.nodes.map((n) => n.y));
  const maxY = Math.max(...sub.nodes.map((n) => n.y + n.h));
  const contentW = Math.max(1, maxX - minX);
  const contentH = Math.max(1, maxY - minY);

  const fitScale = Math.min(parentBox.w / contentW, parentBox.h / contentH);

  if (fitScale * contentW < LEGIBILITY_FLOOR || fitScale * contentH < LEGIBILITY_FLOOR) return null;

  const map = (x: number, y: number): { x: number; y: number } => ({
    x: parentBox.x + (x - minX) * fitScale,
    y: parentBox.y + (y - minY) * fitScale,
  });

  return {
    nodes: sub.nodes.map((n) => {
      const p = map(n.x, n.y);
      return { ...n, x: p.x, y: p.y, w: n.w * fitScale, h: n.h * fitScale };
    }),
    links: sub.links.map((l) => ({
      ...l,
      path: l.path.map((pt) => map(pt.x, pt.y)),
    })),
    // Region boxes are too coarse to read at nested-thumbnail scale — omitted here.
    regions: [],
  };
}

import type { Box } from "@scv/layout";
import { nestedScene } from "@scv/layout";
import type { Edge, Unit } from "@scv/schema";
import { el } from "./svg.js";

/**
 * A true nested mini-map: children laid out by the real layout engine (nestedScene) and
 * drawn as small rects/paths inside the parent box (docs/serve.md#2, "Nested children").
 * Returns null when there's nothing to draw or the box is too small — the caller (node
 * rendering) falls back to a plain child count in that case.
 */
export function minimap(children: Unit[], edges: Edge[], parentBox: Box): SVGGElement | null {
  const sub = nestedScene(children, edges, parentBox);
  if (!sub) return null;

  const g = el("g", { class: "minimap", opacity: 0.8 });

  for (const l of sub.links) {
    const d = l.path.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
    g.appendChild(el("path", { d, class: "minimap-link", fill: "none" }));
  }
  for (const n of sub.nodes) {
    g.appendChild(el("rect", { x: n.x, y: n.y, width: n.w, height: Math.max(2, n.h), class: "minimap-node" }));
  }

  return g;
}

import type { SceneNode } from "@scv/layout";
import { el, ngon, ptstr } from "./svg.js";

const CORNER = 6; // chamfer radius, so tiles read as tiles rather than plain rectangles
const GLYPH_R = 7.5;

/**
 * Renders one Scene node as an SVG <g>: a chamfered tile sized to the node's box, a
 * complexity glyph (sides = bucket, per docs/serve.md#2 "sides = complexity, with a
 * correction"), and an offset risk ring when `ring` is set (docs/serve.md#2, "Offset ring").
 */
export function node(n: SceneNode): SVGGElement {
  const g = el("g", { class: "tile" });
  g.dataset.id = n.id;

  const ch = Math.min(CORNER, n.h / 4, n.w / 4);
  const pts: Array<[number, number]> = [
    [n.x + ch, n.y],
    [n.x + n.w, n.y],
    [n.x + n.w, n.y + n.h - ch],
    [n.x + n.w - ch, n.y + n.h],
    [n.x, n.y + n.h],
    [n.x, n.y + ch],
  ];
  g.appendChild(el("polygon", { points: ptstr(pts), class: "tile-body" }));

  const nameSize = Math.min(14, Math.max(10.5, n.w / 10));
  const label = el("text", { x: n.x + 12, y: n.y + 22, class: "nm", "font-size": nameSize });
  label.textContent = n.name;
  g.appendChild(label);

  const meta = el("text", { x: n.x + 12, y: n.y + 36, class: "mt", "font-size": 9.5 });
  meta.textContent = `${n.sloc} sloc · in ${n.fanIn} · out ${n.fanOut}`;
  g.appendChild(meta);

  if (n.ring) {
    const ringPts = pts.map(([x, y]) => [x + 3, y + 3] as [number, number]);
    g.appendChild(el("polygon", { points: ptstr(ringPts), class: "ring", fill: "none" }));
  }

  const gx = n.x + n.w - GLYPH_R - 6;
  const gy = n.y + GLYPH_R + 6;
  if (n.sides === 0) {
    g.appendChild(el("circle", { cx: gx, cy: gy, r: GLYPH_R, class: "complexity-glyph" }));
  } else {
    g.appendChild(el("polygon", { points: ptstr(ngon(gx, gy, GLYPH_R, n.sides)), class: "complexity-glyph" }));
  }

  return g;
}

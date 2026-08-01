import type { SceneLink } from "@scv/layout";
import { el } from "./svg.js";

export type LinkOptions = {
  /** True once links.length > nodes.length * 1.6 (docs/serve.md#3, "density gating"). */
  gated?: boolean;
  /** Hovered/selected unit id — an edge touching it stays at full strength even when gated. */
  focusId?: string;
};

function pathD(points: SceneLink["path"]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
}

/**
 * Renders one SceneLink as an SVG <path>. Above the density-gating threshold, background
 * edges go faint and only edges touching the focused unit draw at full strength — the graph
 * stays complete, the ink does not (docs/serve.md#3, "density gating").
 */
export function link(l: SceneLink, options: LinkOptions = {}): SVGPathElement {
  const touchesFocus = options.focusId !== undefined && (l.from === options.focusId || l.to === options.focusId);
  const faint = Boolean(options.gated) && !touchesFocus;

  const p = el("path", { d: pathD(l.path), class: faint ? "lk faint" : "lk", fill: "none" });
  p.dataset.from = l.from;
  p.dataset.to = l.to;
  p.dataset.weight = String(l.bundle.length);
  return p;
}

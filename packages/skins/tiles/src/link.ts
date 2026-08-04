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

function midpoint(points: SceneLink["path"]): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  const mid = points[Math.floor((points.length - 1) / 2)]!;
  return mid;
}

const FLOW_LABEL: Record<NonNullable<SceneLink["flowType"]>, string> = {
  sequential: "",
  true: "T",
  false: "F",
  "loop-back": "↺",
  exception: "!",
};

/**
 * Renders one SceneLink as an SVG <g> wrapping a <path>. Above the density-gating
 * threshold, background edges go faint and only edges touching the focused unit draw at
 * full strength — the graph stays complete, the ink does not (docs/serve.md#3, "density
 * gating"). When the link carries a flowType (buildFlowchartScene output), a small
 * midpoint label (T/F/loop icon) is added — consistent with the existing link styling,
 * not a new visual language.
 */
export function link(l: SceneLink, options: LinkOptions = {}): SVGGElement {
  const touchesFocus = options.focusId !== undefined && (l.from === options.focusId || l.to === options.focusId);
  const faint = Boolean(options.gated) && !touchesFocus;

  const g = el("g", { class: "lk-wrap" });
  const p = el("path", { d: pathD(l.path), class: faint ? "lk faint" : "lk", fill: "none" });
  p.dataset.from = l.from;
  p.dataset.to = l.to;
  p.dataset.weight = String(l.bundle.length);
  g.appendChild(p);

  if (l.flowType && FLOW_LABEL[l.flowType]) {
    const mid = midpoint(l.path);
    const label = el("text", { x: mid.x, y: mid.y, class: "lk-label" });
    label.textContent = FLOW_LABEL[l.flowType];
    g.appendChild(label);
  }

  return g;
}

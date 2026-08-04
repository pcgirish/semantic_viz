import type { SceneRegion } from "@scv/layout";
import { el } from "./svg.js";
import { hashLayerToColor } from "./theme.js";

/**
 * Renders one Scene region as an SVG <g>: a dashed rect around the group's bounding box
 * plus an uppercase label — the architecture-level grouping drawn directly into the
 * existing canvas, not a separate view. Colored via the same hashLayerToColor palette
 * tiles already use, so regions read as an extension of the existing visual language.
 */
export function region(r: SceneRegion): SVGGElement {
  const g = el("g", { class: "region" });
  g.dataset.id = r.id;
  g.style.pointerEvents = "none";

  const color = hashLayerToColor(r.id);
  g.appendChild(
    el("rect", {
      x: r.x,
      y: r.y,
      width: r.w,
      height: r.h,
      class: "region-body",
      fill: "none",
      stroke: color,
      "stroke-dasharray": "6 4",
    }),
  );

  const label = el("text", { x: r.x + 8, y: r.y + 16, class: "region-label" });
  label.textContent = r.name.toUpperCase();
  g.appendChild(label);

  return g;
}

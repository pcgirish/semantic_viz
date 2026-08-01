import { useEffect, useRef, useState } from "react";
import type { Edge, Unit } from "@scv/schema";
import { buildScene } from "@scv/layout";
import { tilesSkin } from "@scv/skin-tiles";
import { useAppStore } from "./store.js";

export type CanvasHostProps = {
  units: Unit[];
  edges: Edge[];
};

/**
 * Canvas host: builds a Scene from units/edges and draws it with the tiles skin's
 * node()/link() renderers (docs/serve.md#1 — layout produces the Scene, the skin draws
 * it, nothing else computes positions). Click selects, double-click drills; double-click
 * on empty canvas ascends (docs/serve.md#4, "Current" view navigation).
 *
 * Hovering a unit highlights its depends_on (outgoing) and users (incoming) edges in
 * distinct classes and dims everything else (docs/serve.md#5 — "Direction is a distinct
 * visual question from connection").
 */
export function CanvasHost({ units, edges }: CanvasHostProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);
  const select = useAppStore((s) => s.select);
  const drill = useAppStore((s) => s.drill);
  const ascend = useAppStore((s) => s.ascend);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.innerHTML = "";

    const scene = buildScene(units, edges);
    const gated = scene.links.length > scene.nodes.length * 1.6;

    if (scene.nodes.length > 0) {
      const pad = 24;
      const minX = Math.min(...scene.nodes.map((n) => n.x)) - pad;
      const minY = Math.min(...scene.nodes.map((n) => n.y)) - pad;
      const maxX = Math.max(...scene.nodes.map((n) => n.x + n.w)) + pad;
      const maxY = Math.max(...scene.nodes.map((n) => n.y + n.h)) + pad;
      svg.setAttribute("viewBox", `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
    } else {
      svg.setAttribute("viewBox", "0 0 1 1");
    }

    const linkLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const nodeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    svg.appendChild(linkLayer);
    svg.appendChild(nodeLayer);

    const related = new Set<string>();
    if (hover) {
      related.add(hover);
      for (const l of scene.links) {
        if (l.from === hover) related.add(l.to);
        if (l.to === hover) related.add(l.from);
      }
    }

    for (const l of scene.links) {
      const el = tilesSkin.link(l, { gated });
      if (hover) {
        if (l.from === hover) el.classList.add("depends-on");
        else if (l.to === hover) el.classList.add("used-by");
        else el.classList.add("dim");
      }
      linkLayer.appendChild(el);
    }
    for (const n of scene.nodes) {
      const el = tilesSkin.node(n);
      if (hover && !related.has(n.id)) el.classList.add("dim");
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        select(n.id);
      });
      el.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        drill(n.id);
      });
      el.addEventListener("mouseenter", () => setHover(n.id));
      el.addEventListener("mouseleave", () => setHover((h) => (h === n.id ? null : h)));
      nodeLayer.appendChild(el);
    }
  }, [units, edges, select, drill, hover]);

  return (
    <svg
      ref={svgRef}
      className="canvas"
      data-testid="canvas-svg"
      onDoubleClick={() => ascend()}
      width="100%"
      height="100%"
    />
  );
}

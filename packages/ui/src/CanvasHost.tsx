import { useEffect, useRef } from "react";
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
 */
export function CanvasHost({ units, edges }: CanvasHostProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);
  const select = useAppStore((s) => s.select);
  const drill = useAppStore((s) => s.drill);
  const ascend = useAppStore((s) => s.ascend);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.innerHTML = "";

    const scene = buildScene(units, edges);
    const gated = scene.links.length > scene.nodes.length * 1.6;

    const linkLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const nodeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    svg.appendChild(linkLayer);
    svg.appendChild(nodeLayer);

    for (const l of scene.links) {
      linkLayer.appendChild(tilesSkin.link(l, { gated }));
    }
    for (const n of scene.nodes) {
      const el = tilesSkin.node(n);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        select(n.id);
      });
      el.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        drill(n.id);
      });
      nodeLayer.appendChild(el);
    }
  }, [units, edges, select, drill]);

  return (
    <svg
      ref={svgRef}
      data-testid="canvas-svg"
      onDoubleClick={() => ascend()}
      width="100%"
      height="100%"
    />
  );
}

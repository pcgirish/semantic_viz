import { useEffect, useRef } from "react";
import type { Edge, Unit } from "@scv/schema";
import { buildFlowchartScene } from "@scv/layout";
import { tilesSkin } from "@scv/skin-tiles";

export type FlowchartProps = {
  /** The function unit being drilled into (docs/serve.md#4-style drill, entered by
   *  double-clicking a function tile in Current/Delta). */
  functionUnit: Unit;
  /** Full snapshot units/edges — filtered here to functionUnit's block children. */
  units: Unit[];
  edges: Edge[];
};

/**
 * Renders a function's internal control-flow flowchart: filters the snapshot to
 * functionUnit's block children/control_flow edges, lays them out via
 * buildFlowchartScene, and draws them with the same tilesSkin node()/link() renderers
 * CanvasHost uses for the structural views — inert boxes, no click/drill (blocks are a
 * detail view, not a further navigation level).
 */
export function Flowchart({ functionUnit, units, edges }: FlowchartProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);

  const blockIds = new Set(functionUnit.children);
  const blocks = units.filter((u) => u.kind === "block" && blockIds.has(u.id));
  const cfEdges = edges.filter((e) => e.kind === "control_flow" && blockIds.has(e.from) && blockIds.has(e.to));

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.innerHTML = "";
    if (blocks.length === 0) return;

    const scene = buildFlowchartScene(blocks, cfEdges);
    const pad = 24;
    const minX = Math.min(...scene.nodes.map((n) => n.x)) - pad;
    const minY = Math.min(...scene.nodes.map((n) => n.y)) - pad;
    const maxX = Math.max(...scene.nodes.map((n) => n.x + n.w)) + pad;
    const maxY = Math.max(...scene.nodes.map((n) => n.y + n.h)) + pad;
    svg.setAttribute("viewBox", `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);

    const linkLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const nodeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    svg.appendChild(linkLayer);
    svg.appendChild(nodeLayer);

    for (const l of scene.links) linkLayer.appendChild(tilesSkin.link(l));
    for (const n of scene.nodes) nodeLayer.appendChild(tilesSkin.node(n));
  }, [functionUnit.id, blocks, cfEdges]);

  if (blocks.length === 0) {
    return <div className="flowchart-empty">{functionUnit.name} has no branching to show.</div>;
  }

  return (
    <div className="flowchart">
      <svg ref={svgRef} className="flowchart-svg" data-testid="flowchart-svg" />
    </div>
  );
}

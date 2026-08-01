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
type ViewBox = { x: number; y: number; w: number; h: number };

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const ZOOM_FACTOR = 1.1;
const DRAG_THRESHOLD = 3;

function sceneBounds(scene: { nodes: Array<{ x: number; y: number; w: number; h: number }> }): ViewBox {
  if (scene.nodes.length === 0) return { x: 0, y: 0, w: 1, h: 1 };
  const pad = 24;
  const minX = Math.min(...scene.nodes.map((n) => n.x)) - pad;
  const minY = Math.min(...scene.nodes.map((n) => n.y)) - pad;
  const maxX = Math.max(...scene.nodes.map((n) => n.x + n.w)) + pad;
  const maxY = Math.max(...scene.nodes.map((n) => n.y + n.h)) + pad;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function CanvasHost({ units, edges }: CanvasHostProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);
  const select = useAppStore((s) => s.select);
  const drill = useAppStore((s) => s.drill);
  const ascend = useAppStore((s) => s.ascend);
  const [hover, setHover] = useState<string | null>(null);

  // Base (fit-to-scene) box, recomputed only when the scene changes; current pan/zoom
  // is layered on top so hover/selection re-renders never reset the view.
  const baseBoxRef = useRef<ViewBox>({ x: 0, y: 0, w: 1, h: 1 });
  const viewRef = useRef<ViewBox | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; view: ViewBox; moved: boolean } | null>(null);

  const applyViewBox = (svg: SVGSVGElement, box: ViewBox) => {
    svg.setAttribute("viewBox", `${box.x} ${box.y} ${box.w} ${box.h}`);
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.innerHTML = "";

    const scene = buildScene(units, edges);
    const gated = scene.links.length > scene.nodes.length * 1.6;

    baseBoxRef.current = sceneBounds(scene);
    const view = viewRef.current ?? baseBoxRef.current;
    viewRef.current = view;
    applyViewBox(svg, view);

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

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const view = viewRef.current ?? baseBoxRef.current;

    const rect = svg.getBoundingClientRect();
    const px = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
    const py = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
    const anchorX = view.x + px * view.w;
    const anchorY = view.y + py * view.h;

    const factor = e.deltaY < 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;
    const base = baseBoxRef.current;
    const currentScale = base.w / view.w;
    const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, currentScale / factor));
    const w = base.w / nextScale;
    const h = base.h / nextScale;

    const next: ViewBox = {
      x: anchorX - px * w,
      y: anchorY - py * h,
      w,
      h,
    };
    viewRef.current = next;
    applyViewBox(svg, next);
  };

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.target !== svgRef.current) return; // let tile-level handlers own their own clicks
    const view = viewRef.current ?? baseBoxRef.current;
    dragRef.current = { startX: e.clientX, startY: e.clientY, view, moved: false };
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    const svg = svgRef.current;
    if (!drag || !svg) return;
    const rect = svg.getBoundingClientRect();
    const dxPx = e.clientX - drag.startX;
    const dyPx = e.clientY - drag.startY;
    if (Math.abs(dxPx) > DRAG_THRESHOLD || Math.abs(dyPx) > DRAG_THRESHOLD) drag.moved = true;
    if (!drag.moved) return;

    const dx = rect.width > 0 ? (dxPx / rect.width) * drag.view.w : 0;
    const dy = rect.height > 0 ? (dyPx / rect.height) * drag.view.h : 0;
    const next: ViewBox = { x: drag.view.x - dx, y: drag.view.y - dy, w: drag.view.w, h: drag.view.h };
    viewRef.current = next;
    applyViewBox(svg, next);
  };

  const handleMouseUp = () => {
    dragRef.current = null;
  };

  const handleDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (dragRef.current?.moved) return;
    if (e.target !== svgRef.current) return;
    ascend();
  };

  return (
    <svg
      ref={svgRef}
      className="canvas"
      data-testid="canvas-svg"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDoubleClick={handleDoubleClick}
      width="100%"
      height="100%"
    />
  );
}

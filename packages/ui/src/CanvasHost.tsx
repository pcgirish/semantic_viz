import { useEffect, useRef, useState } from "react";
import type { Edge, Unit } from "@scv/schema";
import { buildScene, type Scene } from "@scv/layout";
import { tilesSkin } from "@scv/skin-tiles";
import { useAppStore } from "./store.js";

const HIGH_RISK = 0.5;

export type TileDeltaInfo = { status: string; amount: number; risk: number | null };

export type CanvasHostProps = {
  units: Unit[];
  edges: Edge[];
  /** Present only in delta mode (docs/serve.md#2 — fill saturation = amount, ring = risk≥0.5). */
  deltaByUnit?: Map<string, TileDeltaInfo>;
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
 *
 * Panning uses the wrapping .canvas-scroll div's native scroll position, not the SVG's
 * viewBox — viewBox stays fixed to the scene's bounds in scene units, while the SVG's
 * width/height (CSS pixels) scale with zoom. That makes the browser's own scrollbars
 * work (drag, click-track, keyboard, trackpad) instead of only a bespoke drag handler.
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

export function CanvasHost({ units, edges, deltaByUnit }: CanvasHostProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const select = useAppStore((s) => s.select);
  const drill = useAppStore((s) => s.drill);
  const ascend = useAppStore((s) => s.ascend);
  const [hover, setHover] = useState<string | null>(null);

  // Base (fit-to-scene) box in scene units; the SVG's viewBox always equals this — only
  // its CSS width/height change with zoom, so scroll position (not viewBox) is what pans.
  const baseBoxRef = useRef<ViewBox>({ x: 0, y: 0, w: 1, h: 1 });
  const scaleRef = useRef(1);
  const [renderSize, setRenderSize] = useState({ w: 1, h: 1 });
  const dragRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number; moved: boolean } | null>(null);

  // Nodes/links from the last build, kept around so hover can toggle classes on the
  // existing elements instead of the whole scene being torn down and rebuilt — otherwise
  // every hover replays each delta tile's pulse animation (docs/serve.md#4 "Replay").
  const nodeElsRef = useRef(new Map<string, SVGGElement>());
  const linkElsRef = useRef<Array<{ from: string; to: string; el: SVGElement }>>([]);

  // Last build's Scene, so the next build (e.g. a replay scrub landing on a new rev's
  // units/edges) seeds from it — docs/serve.md#3, "positions are seeded from the previous
  // snapshot ... this is a hard requirement, replay is unreadable if nodes teleport."
  const priorSceneRef = useRef<Scene | undefined>(undefined);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.innerHTML = "";
    nodeElsRef.current = new Map();
    linkElsRef.current = [];

    const scene = buildScene(units, edges, { priorScene: priorSceneRef.current });
    priorSceneRef.current = scene;
    const gated = scene.links.length > scene.nodes.length * 1.6;

    const base = sceneBounds(scene);
    baseBoxRef.current = base;
    svg.setAttribute("viewBox", `${base.x} ${base.y} ${base.w} ${base.h}`);
    setRenderSize({ w: base.w * scaleRef.current, h: base.h * scaleRef.current });

    const linkLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const nodeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    svg.appendChild(linkLayer);
    svg.appendChild(nodeLayer);

    for (const l of scene.links) {
      const el = tilesSkin.link(l, { gated });
      linkElsRef.current.push({ from: l.from, to: l.to, el });
      linkLayer.appendChild(el);
    }
    for (const n of scene.nodes) {
      const el = tilesSkin.node(n);
      const d = deltaByUnit?.get(n.id);
      if (d) {
        el.classList.add(`status-${d.status}`, "pulse");
        el.style.setProperty("--amount", String(d.amount));
        if (d.risk !== null && d.risk >= HIGH_RISK) el.classList.add("high-risk");
      }
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
      nodeElsRef.current.set(n.id, el);
      nodeLayer.appendChild(el);
    }
  }, [units, edges, select, drill, deltaByUnit]);

  // Hover only toggles classes on the existing elements built above — it never rebuilds
  // the scene, so a delta tile's pulse animation plays once (on scrub) and never replays
  // just because the mouse moved over a tile.
  useEffect(() => {
    const related = new Set<string>();
    if (hover) {
      related.add(hover);
      for (const { from, to } of linkElsRef.current) {
        if (from === hover) related.add(to);
        if (to === hover) related.add(from);
      }
    }

    for (const { from, to, el } of linkElsRef.current) {
      el.classList.remove("depends-on", "used-by", "dim");
      if (!hover) continue;
      if (from === hover) el.classList.add("depends-on");
      else if (to === hover) el.classList.add("used-by");
      else el.classList.add("dim");
    }
    for (const [id, el] of nodeElsRef.current) {
      el.classList.toggle("dim", Boolean(hover) && !related.has(id));
    }
  }, [hover]);

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const scroll = scrollRef.current;
    if (!scroll) return;

    const rect = scroll.getBoundingClientRect();
    const px = e.clientX - rect.left + scroll.scrollLeft;
    const py = e.clientY - rect.top + scroll.scrollTop;

    const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
    const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scaleRef.current * factor));
    const ratio = nextScale / scaleRef.current;
    scaleRef.current = nextScale;

    const base = baseBoxRef.current;
    setRenderSize({ w: base.w * nextScale, h: base.h * nextScale });

    // Keep the point under the cursor stationary: it scales by `ratio` in content
    // space, so the scroll offset must grow by the same amount around that point.
    scroll.scrollLeft = px * ratio - (e.clientX - rect.left);
    scroll.scrollTop = py * ratio - (e.clientY - rect.top);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Tile clicks call stopPropagation, so this only fires for empty-canvas mousedowns
    // (on the scroll container or the SVG background itself) — never a tile.
    if (e.target !== svgRef.current && e.target !== scrollRef.current) return;
    const scroll = scrollRef.current;
    if (!scroll) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, scrollLeft: scroll.scrollLeft, scrollTop: scroll.scrollTop, moved: false };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const scroll = scrollRef.current;
    if (!drag || !scroll) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
      drag.moved = true;
      scroll.classList.add("panning");
    }
    if (!drag.moved) return;

    scroll.scrollLeft = drag.scrollLeft - dx;
    scroll.scrollTop = drag.scrollTop - dy;
  };

  const handleMouseUp = () => {
    dragRef.current = null;
    scrollRef.current?.classList.remove("panning");
  };

  const handleDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (dragRef.current?.moved) return;
    if (e.target !== svgRef.current) return;
    ascend();
  };

  return (
    <div
      ref={scrollRef}
      className="canvas-scroll"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <svg
        ref={svgRef}
        className="canvas"
        data-testid="canvas-svg"
        onDoubleClick={handleDoubleClick}
        width={renderSize.w}
        height={renderSize.h}
      />
    </div>
  );
}

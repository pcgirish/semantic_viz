import { useMemo, useRef, useState } from "react";
import type { Edge, Unit } from "@scv/schema";
import { ConnectorLayer, GraphCanvas, PolyNode, neighbours, type FocusState } from "@scv/design-system";
import { buildScene, type Scene } from "@scv/layout";
import { codedreamLayerPalette, hashLayerToColor } from "@scv/skin-tiles";
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
 * Canvas host: builds a Scene from units/edges (@scv/layout, unchanged) and draws it as
 * PolyNode tiles connected by a ConnectorLayer (docs/serve.md#1 — layout produces the
 * Scene, the skin draws it, nothing else computes positions). Click selects, double-click
 * drills; double-click on empty canvas ascends (docs/serve.md#4, "Current" view navigation).
 *
 * Hovering a unit highlights its depends_on (outgoing) and users (incoming) edges
 * distinctly and dims everything else (docs/serve.md#5). Hover flows through PolyNode's
 * `dim`/`selected` props rather than DOM classList mutation — a spike confirmed React
 * preserves each tile's DOM node identity across a hover-only prop change (stable `key`),
 * so a delta tile's pulse animation (applied via a class set once, independent of hover
 * props) does not replay on hover.
 */
type ViewBox = { x: number; y: number; w: number; h: number };

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const ZOOM_FACTOR = 1.1;
const DRAG_THRESHOLD = 3;

const SHAPES: Array<"square" | "chamfer" | "hex" | "hex-tall"> = ["square", "chamfer", "hex", "hex-tall"];

function shapeFor(n: { sides: 3 | 4 | 6 | 0; blockType?: string }): "diamond" | "square" | "chamfer" | "hex" | "hex-tall" {
  if (n.blockType === "decision" || n.blockType === "loop") return "diamond";
  if (n.sides === 0) return "hex-tall";
  if (n.sides === 3) return "square";
  if (n.sides === 6) return "hex";
  return SHAPES[1]!;
}

// --temp-4 (#F2A93B, "changed") as an RGB triple — color-mix() can't be computed inline
// from a JS number, so the delta amount->alpha mix below is done as literal rgba math.
const CHANGED_RGB = "242, 169, 59";

/** Delta-mode tile styling (docs/serve.md#2): fill saturation encodes amount, ring encodes
 * risk>=0.5, added/removed get dedicated outlines rather than colour alone. */
function deltaTileStyle(d: TileDeltaInfo | undefined): React.CSSProperties {
  if (!d) return {};
  if (d.status === "added") return { outline: "2px solid var(--temp-2)", borderRadius: 6 };
  if (d.status === "removed") return { outline: "1.6px dashed var(--temp-6)", borderRadius: 6 };
  if (d.status === "modified" || d.status === "risk_changed" || d.status === "rollup") {
    return { background: `rgba(${CHANGED_RGB}, ${(d.amount ?? 0) * 0.7})`, borderRadius: 6 };
  }
  return {};
}

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
  const select = useAppStore((s) => s.select);
  const drill = useAppStore((s) => s.drill);
  const ascend = useAppStore((s) => s.ascend);
  const showFlowchart = useAppStore((s) => s.showFlowchart);
  const [hover, setHover] = useState<string | null>(null);

  const scaleRef = useRef(1);
  const [renderSize, setRenderSize] = useState({ w: 1, h: 1 });
  const dragRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number; moved: boolean } | null>(null);

  // Last build's Scene, so the next build (e.g. a replay scrub landing on a new rev's
  // units/edges) seeds from it — docs/serve.md#3, "positions are seeded from the previous
  // snapshot ... this is a hard requirement, replay is unreadable if nodes teleport."
  const priorSceneRef = useRef<Scene | undefined>(undefined);

  const unitKindById = useMemo(() => new Map(units.map((u) => [u.id, u.kind])), [units]);

  const scene = useMemo(() => {
    const s = buildScene(units, edges, { priorScene: priorSceneRef.current });
    priorSceneRef.current = s;
    return s;
  }, [units, edges]);

  const base = sceneBounds(scene);
  if (renderSize.w === 1 && renderSize.h === 1 && (base.w !== 1 || base.h !== 1)) {
    // First paint for this scene: seed renderSize from the fitted box at the current scale.
    setRenderSize({ w: base.w * scaleRef.current, h: base.h * scaleRef.current });
  }

  const focus: FocusState = useMemo(() => {
    if (!hover) return { id: null, near: [], far: [] };
    const { near } = neighbours(hover, scene.links, 1);
    return { id: hover, near, far: [] };
  }, [hover, scene.links]);

  const connectorEdges = scene.links.map((l) => {
    const from = scene.nodes.find((n) => n.id === l.from);
    const to = scene.nodes.find((n) => n.id === l.to);
    // Outgoing from the hovered node reads as "depends-on" (call); incoming reads as "used-by" (risk).
    const kind = hover && l.from === hover ? ("call" as const) : hover && l.to === hover ? ("risk" as const) : ("import" as const);
    return {
      x1: (from?.x ?? 0) + (from?.w ?? 0) / 2 - base.x,
      y1: (from?.y ?? 0) + (from?.h ?? 0) - base.y,
      x2: (to?.x ?? 0) + (to?.w ?? 0) / 2 - base.x,
      y2: (to?.y ?? 0) - base.y,
      from: l.from,
      to: l.to,
      kind,
    };
  });

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

    setRenderSize({ w: base.w * nextScale, h: base.h * nextScale });

    // Keep the point under the cursor stationary: it scales by `ratio` in content
    // space, so the scroll offset must grow by the same amount around that point.
    scroll.scrollLeft = px * ratio - (e.clientX - rect.left);
    scroll.scrollTop = py * ratio - (e.clientY - rect.top);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Tile clicks call stopPropagation, so this only fires for empty-canvas mousedowns.
    if (e.target !== scrollRef.current && (e.target as HTMLElement).dataset?.id) return;
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
      scroll.style.overflow = "auto";
    }
    if (!drag.moved) return;

    scroll.scrollLeft = drag.scrollLeft - dx;
    scroll.scrollTop = drag.scrollTop - dy;
  };

  const handleMouseUp = () => {
    dragRef.current = null;
    const scroll = scrollRef.current;
    scroll?.classList.remove("panning");
    if (scroll) scroll.style.overflow = "hidden";
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragRef.current?.moved) return;
    if ((e.target as HTMLElement).dataset?.id) return;
    ascend();
  };

  return (
    <div
      ref={scrollRef}
      className="canvas-scroll"
      data-testid="canvas-svg"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => {
        handleMouseUp();
        setHover(null);
      }}
      onDoubleClick={handleDoubleClick}
      style={{
        width: renderSize.w,
        height: renderSize.h,
        flex: 1,
        minWidth: 0,
        overflow: "hidden",
        background:
          "linear-gradient(var(--border-hair) 1px, transparent 1px) 0 0 / 100% 28px," +
          "linear-gradient(90deg, var(--border-hair) 1px, transparent 1px) 0 0 / 28px 100%," +
          "var(--surface-0)",
      }}
    >
      <GraphCanvas grid={false} style={{ width: "100%", height: "100%" }}>
        {scene.regions.map((r) => (
          <div
            key={r.id}
            className="region"
            data-id={r.id}
            style={{
              position: "absolute",
              left: r.x - base.x,
              top: r.y - base.y,
              width: r.w,
              height: r.h,
              pointerEvents: "none",
              border: "var(--border-w) dashed var(--border-1)",
              borderRadius: "var(--radius-md)",
              background: "rgba(152,174,191,0.035)",
            }}
          >
            <span
              className="region-label"
              style={{
                position: "absolute",
                top: -9,
                left: 12,
                padding: "1px 8px 1px 6px",
                background: "var(--surface-3)",
                color: "var(--text-faint)",
                font: "600 10px var(--font-mono)",
                textTransform: "uppercase",
                letterSpacing: "0.09em",
                clipPath: "var(--clip-chamfer-sm)",
                border: "var(--border-w) solid var(--border-1)",
                whiteSpace: "nowrap",
              }}
            >
              {r.name.toUpperCase()}
            </span>
          </div>
        ))}
        <ConnectorLayer edges={connectorEdges} route="ortho" arrows={false} focus={focus} />
        {scene.nodes.map((n) => {
          const d = deltaByUnit?.get(n.id);
          const highRisk = d?.risk !== null && d?.risk !== undefined && d.risk >= HIGH_RISK;
          // serve.md#2: hue encodes layer (categorical), not `heat` — heat is always 0
          // from layout.ts today, so falling back to it would render every tile dormant-gray.
          const layerColor = n.layer ? hashLayerToColor(n.layer, codedreamLayerPalette) : undefined;
          const deltaStyle = deltaTileStyle(d);
          return (
            <PolyNode
              key={n.id}
              id={n.id}
              data-id={n.id}
              className="tile"
              label={n.name}
              shape={shapeFor(n)}
              size={n.w}
              color={layerColor}
              focus={focus}
              onFocusNode={(id: string) => setHover(id)}
              style={{
                position: "absolute",
                left: n.x - base.x,
                top: n.y - base.y,
                height: n.h,
                ...deltaStyle,
                ...(highRisk ? { filter: "drop-shadow(0 0 0 1px var(--temp-6))" } : {}),
              } as React.CSSProperties}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                select(n.id);
              }}
              onDoubleClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                // Double-clicking a function tile opens its flowchart detail view instead of
                // drilling further down the structural tree — a function has no children to
                // drill into in Current/Delta, so this replaces what would otherwise be a no-op.
                if (unitKindById.get(n.id) === "function") showFlowchart(n.id);
                else drill(n.id);
              }}
            />
          );
        })}
      </GraphCanvas>
    </div>
  );
}

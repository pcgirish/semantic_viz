import { useMemo, useRef, useState } from "react";
import type { Edge, Unit } from "@scv/schema";
import { ConnectorLayer, GraphCanvas, PolyNode, neighbours, type FocusState } from "@scv/design-system";
import { buildScene, type Scene } from "@scv/layout";
import { codedreamLayerPalette, hashLayerToColor } from "@scv/skin-tiles";
import { useAppStore } from "./store.js";
import { sceneBounds, usePanZoom } from "./usePanZoom.js";

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

export function CanvasHost({ units, edges, deltaByUnit }: CanvasHostProps): JSX.Element {
  const select = useAppStore((s) => s.select);
  const drill = useAppStore((s) => s.drill);
  const ascend = useAppStore((s) => s.ascend);
  const [hover, setHover] = useState<string | null>(null);

  // Last build's Scene, so the next build (e.g. a replay scrub landing on a new rev's
  // units/edges) seeds from it — docs/serve.md#3, "positions are seeded from the previous
  // snapshot ... this is a hard requirement, replay is unreadable if nodes teleport."
  const priorSceneRef = useRef<Scene | undefined>(undefined);

  const scene = useMemo(() => {
    const s = buildScene(units, edges, { priorScene: priorSceneRef.current });
    priorSceneRef.current = s;
    return s;
  }, [units, edges]);

  const base = sceneBounds(scene);

  const { scrollRef, scale, renderSize, didPan, handlers } = usePanZoom(base);

  const focus: FocusState = useMemo(() => {
    if (!hover) return { id: null, near: [], far: [] };
    const { near } = neighbours(hover, scene.links, 1);
    return { id: hover, near, far: [] };
  }, [hover, scene.links]);

  const connectorEdges = scene.links.flatMap((l) => {
    // route.ts's spreadPorts already fans each node's in/out edges across its border
    // (docs/serve.md#3 fix #3), and for a skip-level edge (e.g. rank 1 -> rank 4) `path`
    // also carries a waypoint at every intervening rank (expand.ts's dummy nodes) so the
    // edge can be routed around the boxes in between rather than drawn as one long chord
    // straight through them. Emitting a single x1/y1->x2/y2 segment from path[0]/path[last]
    // (as this used to) discards those waypoints and draws exactly that chord — the "messy
    // pool of connectors" sweeping diagonally across unrelated rows.
    // Mock's bindHoverTrace: edges *into* the hovered node (to === hover) go azure
    // ("incoming"), edges *out of* it (from === hover) go temp-4/orange ("outgoing").
    const kind =
      hover && l.to === hover ? ("hover-in" as const) : hover && l.from === hover ? ("hover-out" as const) : ("import" as const);
    // Mock fixture data (docs/mock/codedream-ui-mock.html): every edge has weight:1 except
    // one weight:3 edge marked heavy:true — so anything above the baseline weight is heavy.
    const heavy = (l.weight ?? 1) > 1;
    const segments: {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      from: string;
      to: string;
      kind: typeof kind;
      route: "ortho" | "ortho-v";
      clearY?: number;
      heavy: boolean;
    }[] = [];
    for (let i = 0; i < l.path.length - 1; i++) {
      const start = l.path[i]!;
      const end = l.path[i + 1]!;
      // Mirror the mock's routing split (codedream-ui-mock.html's renderCurrentMode): a
      // same-rank hop (equal y) goes Manhattan/ortho, entering the node face at 90deg
      // top/bottom; a cross-rank hop uses the same vertical-port Manhattan routing as
      // Flowchart.tsx (ortho-v) rather than a bezier — a curve's approach bends sideways
      // right up to the node face, so even though its tangent lands exactly vertical at
      // the endpoint, the arrowhead reads as misaligned with the visibly diagonal line
      // feeding into it.
      const sameRank = start.y === end.y;
      segments.push({
        x1: start.x - base.x,
        y1: start.y - base.y,
        x2: end.x - base.x,
        y2: end.y - base.y,
        from: l.from,
        to: l.to,
        kind,
        route: sameRank ? "ortho" : "ortho-v",
        clearY: sameRank ? undefined : (start.y + end.y) / 2 - base.y,
        heavy,
      });
    }
    return segments;
  });

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (didPan()) return;
    if ((e.target as HTMLElement).dataset?.id) return;
    ascend();
  };

  return (
    <div
      ref={scrollRef}
      className="canvas-scroll"
      data-testid="canvas-svg"
      onMouseDown={handlers.onMouseDown}
      onMouseMove={handlers.onMouseMove}
      onMouseUp={handlers.onMouseUp}
      onMouseLeave={() => {
        handlers.onMouseUp();
        setHover(null);
      }}
      onDoubleClick={handleDoubleClick}
      style={{
        flex: 1,
        minWidth: 0,
        overflow: "auto",
        background:
          "linear-gradient(var(--border-hair) 1px, transparent 1px) 0 0 / 100% 28px," +
          "linear-gradient(90deg, var(--border-hair) 1px, transparent 1px) 0 0 / 28px 100%," +
          "var(--surface-0)",
      }}
    >
      {/*
        The scroll container is the viewport; this is the content. Nodes are positioned at raw
        scene coordinates, so zoom has to be a transform on their common ancestor — sizing the
        viewport alone (as this did) resized the box without ever scaling what was inside it.
        `renderSize` gives the scrolled extent at the current scale; `transformOrigin` pins the
        scale to the top-left so scene coordinates and scroll offsets stay in the same space.
      */}
      {/*
        Two layers, because scrolling and scaling need different sizes. The outer one is the
        scrolled extent — the scene at the current scale, which is what gives the container
        real scrollbars. The inner one stays at raw scene dimensions (nodes are positioned in
        scene coordinates) and is scaled into place, pinned to the top-left so scene
        coordinates and scroll offsets remain in the same space.
      */}
      <div className="canvas-extent" style={{ width: renderSize.w, height: renderSize.h, position: "relative" }}>
      <div
        className="canvas-scale"
        style={{
          width: base.w,
          height: base.h,
          position: "absolute",
          top: 0,
          left: 0,
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
        }}
      >
      <GraphCanvas grid={false} style={{ position: "absolute", inset: 0 }}>
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
        <ConnectorLayer edges={connectorEdges} focus={focus} />
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
                // Drilling into a function has no structural children in Current/Delta —
                // App.tsx renders that zoom level as a Flowchart instead of a tile grid.
                drill(n.id);
              }}
            />
          );
        })}
      </GraphCanvas>
      </div>
      </div>
    </div>
  );
}

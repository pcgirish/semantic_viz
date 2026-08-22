import { Fragment, useMemo, useRef, useState } from "react";
import type { Edge, Unit } from "@scv/schema";
import { ConnectorLayer, GraphCanvas, neighbours, type FocusState } from "@scv/design-system";
import { buildScene, type BoundaryEdge, type Scene } from "@scv/layout";
import { codedreamLayerPalette, hashLayerToColor, node as tile, region as regionBox } from "@scv/skin-tiles";
import { DEFAULT_EDGE_BUDGET } from "./edge-budget.js";
import { useAppStore } from "./store.js";
import { sceneBounds, usePanZoom } from "./usePanZoom.js";

export type TileDeltaInfo = { status: string; amount: number; risk: number | null };

export type CanvasHostProps = {
  units: Unit[];
  edges: Edge[];
  /** Present only in delta mode (docs/serve.md#2 — fill saturation = amount, ring = risk≥0.5). */
  deltaByUnit?: Map<string, TileDeltaInfo>;
  /** Edges leaving the focused subtree; each collapses onto a boundary marker on the frame. */
  boundaryEdges?: BoundaryEdge[];
  /** The units those markers stand for, for their display name. */
  externalUnits?: Unit[];
  /** Connectors the edge budget dropped before this scene was built. Shown as an overlay: a
   *  truncated view that does not say so is indistinguishable from a sparse one. */
  elidedEdges?: number;
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
export function CanvasHost({ units, edges, deltaByUnit, boundaryEdges, externalUnits, elidedEdges = 0 }: CanvasHostProps): JSX.Element {
  const select = useAppStore((s) => s.select);
  const drill = useAppStore((s) => s.drill);
  const ascend = useAppStore((s) => s.ascend);
  const [hover, setHover] = useState<string | null>(null);

  // Last build's Scene, so the next build (e.g. a replay scrub landing on a new rev's
  // units/edges) seeds from it — docs/serve.md#3, "positions are seeded from the previous
  // snapshot ... this is a hard requirement, replay is unreadable if nodes teleport."
  const priorSceneRef = useRef<Scene | undefined>(undefined);

  const scene = useMemo(() => {
    const s = buildScene(units, edges, { priorScene: priorSceneRef.current, boundaryEdges, externalUnits });
    priorSceneRef.current = s;
    return s;
  }, [units, edges, boundaryEdges, externalUnits]);

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
    // An unresolved connector draws dashed ("weak") unless hover is actively recoloring it —
    // the hover trace answers "what touches this node", and losing that answer to a provenance
    // cue would trade the more urgent question for the less urgent one.
    const kind =
      hover && l.to === hover
        ? ("hover-in" as const)
        : hover && l.from === hover
          ? ("hover-out" as const)
          : l.unresolved
            ? ("weak" as const)
            : ("import" as const);
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
      {/* Sticky, not absolute: the badge annotates the viewport, and an absolutely-positioned
          child of the scroll container would scroll off with the scene it is describing. */}
      {elidedEdges > 0 && (
        <div
          data-testid="edges-elided"
          style={{
            position: "sticky",
            top: 0,
            float: "right",
            zIndex: 2,
            margin: 8,
            padding: "4px 8px",
            background: "var(--surface-sunken)",
            border: "var(--border-w) solid var(--border-hair)",
            borderRadius: "var(--radius-xs)",
            color: "var(--text-faint)",
            fontSize: 11,
            pointerEvents: "none",
          }}
        >
          {elidedEdges} connectors hidden — showing the strongest {DEFAULT_EDGE_BUDGET}
        </div>
      )}
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
          <Fragment key={r.id}>{regionBox(r, { origin: base })}</Fragment>
        ))}
        <ConnectorLayer edges={connectorEdges} focus={focus} />
        {scene.nodes.map((n) => {
          const d = deltaByUnit?.get(n.id);
          // serve.md#2: hue encodes layer (categorical), not `heat` — heat is always 0
          // from layout.ts today, so falling back to it would render every tile dormant-gray.
          const layerColor = n.layer ? hashLayerToColor(n.layer, codedreamLayerPalette) : undefined;
          // The skin owns how a tile looks; the host supplies only what the Scene cannot
          // say (delta, hue) and what only a DOM host knows (origin, handlers). The stable
          // `key` is load-bearing: it preserves each tile's DOM node identity across a
          // hover-only prop change, so a delta tile's pulse animation does not replay.
          return (
            <Fragment key={n.id}>
              {tile(n, {
                delta: d,
                layerColor,
                origin: base,
                focus,
                onFocusNode: (id: string) => setHover(id),
                onClick: (e) => {
                  e.stopPropagation();
                  select(n.id);
                },
                onDoubleClick: (e) => {
                  e.stopPropagation();
                  // Drilling into a function has no structural children in Current/Delta —
                  // App.tsx renders that zoom level as a Flowchart instead of a tile grid.
                  drill(n.id);
                },
              })}
            </Fragment>
          );
        })}
      </GraphCanvas>
      </div>
      </div>
    </div>
  );
}

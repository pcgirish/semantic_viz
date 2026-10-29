import { ConnectorLayer, GraphCanvas, PolyNode } from "@semviz/design-system";
import type { Edge, Unit } from "@semviz/schema";
import { buildFlowchartScene } from "@semviz/layout";
import { sceneBounds, usePanZoom } from "./usePanZoom.js";

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
 * buildFlowchartScene, and draws them as PolyNodes (diamond for decision/loop blocks)
 * connected by a ConnectorLayer — inert boxes, no click/drill (blocks are a detail view,
 * not a further navigation level). Pan/zoom/fit comes from the shared usePanZoom hook, the
 * same one CanvasHost uses: a deep control-flow graph overflows the viewport just as a large
 * module graph does, and scrollbars alone give no way to zoom out to see the whole shape.
 */
export function Flowchart({ functionUnit, units, edges }: FlowchartProps): JSX.Element {
  const blockIds = new Set(functionUnit.children);
  const blocks = units.filter((u) => u.kind === "block" && blockIds.has(u.id));
  const cfEdges = edges.filter((e) => e.kind === "control_flow" && blockIds.has(e.from) && blockIds.has(e.to));

  // Built before the empty-state guard: usePanZoom below is a hook and cannot sit after a
  // conditional return. buildFlowchartScene on an empty block list yields an empty scene,
  // which sceneBounds already handles (1x1 sentinel box, no fit).
  const scene = buildFlowchartScene(blocks, cfEdges);
  const base = sceneBounds(scene);
  const { scrollRef, scale, renderSize, handlers } = usePanZoom(base);
  const minX = base.x;
  const minY = base.y;
  const nodeById = new Map(scene.nodes.map((n) => [n.id, n]));

  const cfEdgeByPair = new Map(cfEdges.map((e) => [`${e.from} ${e.to}`, e]));

  const connectorEdges = scene.links
    .map((l) => {
      const from = nodeById.get(l.from);
      const to = nodeById.get(l.to);
      if (!from || !to) return null;
      // Branch label/color from the underlying control_flow edge. Prefer the LLM-authored
      // edgeLabel (semantic, e.g. "invalid"/"valid") since generic "yes"/"no" only reads
      // correctly when it happens to match the decision block's own label polarity — a
      // negated condition like "not payload.ok" makes true->yes read backwards.
      const cfEdge = cfEdgeByPair.get(`${l.from} ${l.to}`);
      const flowType = cfEdge?.flowType;
      const label = cfEdge?.edgeLabel ?? (flowType === "true" ? "yes" : flowType === "false" ? "no" : undefined);
      return {
        x1: from.x + from.w / 2 - minX,
        y1: from.y + from.h - minY,
        x2: to.x + to.w / 2 - minX,
        y2: to.y - minY,
        // A raise/throw exit is the risk path and gets red styling, whether it's a pure
        // "exception" edge or a branch ("true"/"false") that happens to raise — a plain
        // "return" on that same branch type stays neutral.
        kind: flowType === "exception" || cfEdge?.raises ? ("risk" as const) : ("call" as const),
        label,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  if (blocks.length === 0) {
    return (
      <div
        className="flowchart-empty"
        style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)" }}
      >
        {functionUnit.name} has no branching to show.
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flowchart canvas-scroll"
      data-testid="flowchart-svg"
      onMouseDown={handlers.onMouseDown}
      onMouseMove={handlers.onMouseMove}
      onMouseUp={handlers.onMouseUp}
      onMouseLeave={handlers.onMouseUp}
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
      {/* Two layers, matching CanvasHost: the outer one is the scrolled extent at the current
          scale (what gives the container real scrollbars); the inner one stays at raw scene
          dimensions and is scaled into place, pinned top-left so scene coordinates and scroll
          offsets remain in the same space. */}
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
          <ConnectorLayer edges={connectorEdges} route="ortho-v" />
          {scene.nodes.map((n) => {
            const isDiamond = n.blockType === "decision" || n.blockType === "loop";
            const isTerminal = n.blockType === "entry" || n.blockType === "exit";
            const shape = isDiamond ? "diamond" : isTerminal ? "pill" : "chamfer";
            return (
              <PolyNode
                key={n.id}
                id={n.id}
                className={isDiamond ? "block-diamond tile" : "tile"}
                label={n.name}
                shape={shape}
                size={n.w}
                height={n.h}
                style={{ position: "absolute", left: n.x - minX, top: n.y - minY }}
              />
            );
          })}
        </GraphCanvas>
      </div>
      </div>
    </div>
  );
}

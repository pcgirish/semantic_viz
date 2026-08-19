import { ConnectorLayer, GraphCanvas, PolyNode } from "@scv/design-system";
import type { Edge, Unit } from "@scv/schema";
import { buildFlowchartScene } from "@scv/layout";

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
 * not a further navigation level).
 */
export function Flowchart({ functionUnit, units, edges }: FlowchartProps): JSX.Element {
  const blockIds = new Set(functionUnit.children);
  const blocks = units.filter((u) => u.kind === "block" && blockIds.has(u.id));
  const cfEdges = edges.filter((e) => e.kind === "control_flow" && blockIds.has(e.from) && blockIds.has(e.to));

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

  const scene = buildFlowchartScene(blocks, cfEdges);
  const pad = 24;
  const minX = Math.min(...scene.nodes.map((n) => n.x)) - pad;
  const minY = Math.min(...scene.nodes.map((n) => n.y)) - pad;
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
        // "exception" always exits the function abnormally, regardless of which branch
        // it descends from — that's the actual risk path. "false" just means the
        // condition was false; it's the normal continuation as often as an error path,
        // so it gets neutral styling like "true" does.
        kind: flowType === "exception" ? ("risk" as const) : ("call" as const),
        label,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  return (
    <div
      className="flowchart"
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
      <div data-testid="flowchart-svg" className="flowchart-svg" style={{ width: "100%", height: "100%", display: "block" }}>
        <GraphCanvas grid={false} style={{ width: "100%", height: "100%" }}>
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
  );
}

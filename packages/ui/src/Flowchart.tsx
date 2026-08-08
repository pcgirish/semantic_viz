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
  const route = units.find((u) => u.kind === "api_flow" && u.steps?.includes(functionUnit.id))?.route;

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

  const connectorEdges = scene.links
    .map((l) => {
      const from = nodeById.get(l.from);
      const to = nodeById.get(l.to);
      if (!from || !to) return null;
      return {
        x1: from.x + from.w / 2 - minX,
        y1: from.y + from.h - minY,
        x2: to.x + to.w / 2 - minX,
        y2: to.y - minY,
        kind: "control" as const,
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
      <div className="flowchart-header">
        <span className="flowchart-header-qualname">{functionUnit.qualname}</span>
        {route && <span className="flowchart-header-route">{route}</span>}
      </div>
      <div data-testid="flowchart-svg" className="flowchart-svg" style={{ width: "100%", height: "100%", display: "block" }}>
        <GraphCanvas grid={false} style={{ width: "100%", height: "100%" }}>
          <ConnectorLayer edges={connectorEdges} route="ortho" />
          {scene.nodes.map((n) => {
            const isDiamond = n.blockType === "decision" || n.blockType === "loop";
            return (
              <PolyNode
                key={n.id}
                id={n.id}
                className={isDiamond ? "block-diamond tile" : "tile"}
                label={n.name}
                shape={isDiamond ? "diamond" : "chamfer"}
                size={n.w}
                style={{ position: "absolute", left: n.x - minX, top: n.y - minY, height: n.h }}
              />
            );
          })}
        </GraphCanvas>
      </div>
    </div>
  );
}

import { useState } from "react";
import { Badge, ConnectorLayer, GraphCanvas, Tray } from "@scv/design-system";
import type { Edge, StepBranch, Unit } from "@scv/schema";

const NODE_W = 200;
const COL_GAP = 140;
const ROW_H = 100;

export type FlowsProps = {
  /** kind:"api_flow" units (docs/serve.md#4 "Flows"). */
  flows: Unit[];
  units: Unit[];
  edges: Edge[];
  onSelectStep: (unitId: string) => void;
  /** Present only in Delta mode — unit ids that changed, so a traversed step carries a
   *  status dot ("did this PR touch the checkout path" is one glance, per docs/serve.md#4). */
  changedStepIds?: Set<string>;
};

/** No explicit entry-kind field on Unit yet — every fixture's routes are HTTP, so a route
 *  string is grouped as "http" and anything else falls back to "other" rather than
 *  inventing a schema field the analyzer doesn't produce (docs/serve.md#4 groups by
 *  http/cli/event/schedule; this is the http-only subset of that). */
function entryKind(route: string | undefined): string {
  if (route && /^(GET|POST|PUT|PATCH|DELETE)\s/.test(route)) return "http";
  return "other";
}

function edgeKind(edges: Edge[], from: string, to: string): string | undefined {
  return edges.find((e) => e.from === from && e.to === to)?.kind;
}

type PositionedStep = { unit: string; col: number; row: number; parent: string | null; label?: string };

/** Flattens a StepBranch tree into a column-per-depth, row-per-leaf-lane layout: each node's
 *  column is its depth, and each node's row is the mean of its descendant leaves' rows (a leaf
 *  gets the next free row), so parallel branches (e.g. success/failure) land in their own lanes
 *  instead of overlapping. */
function layoutBranching(root: StepBranch): PositionedStep[] {
  const positioned: PositionedStep[] = [];
  let nextRow = 0;

  function visit(node: StepBranch, col: number, parent: string | null, label: string | undefined): number {
    const children = node.children ?? [];
    const entry: PositionedStep = { unit: node.unit, col, row: 0, parent, label };
    positioned.push(entry);
    if (children.length === 0) {
      entry.row = nextRow++;
      return entry.row;
    }
    const childRows = children.map((c) => visit(c, col + 1, node.unit, c.label));
    entry.row = childRows.reduce((a, b) => a + b, 0) / childRows.length;
    return entry.row;
  }

  visit(root, 0, null, undefined);
  return positioned;
}

export function Flows({ flows, units, edges, onSelectStep, changedStepIds }: FlowsProps): JSX.Element {
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(flows[0]?.id ?? null);

  if (flows.length === 0) {
    return (
      <div
        className="flows-empty"
        style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)", fontSize: 12 }}
      >
        No entry points recorded for this snapshot.
      </div>
    );
  }

  const selectedFlow = flows.find((f) => f.id === selectedFlowId) ?? flows[0]!;
  const unitsById = new Map(units.map((u) => [u.id, u]));
  const groups = new Map<string, Unit[]>();
  for (const f of flows) {
    const k = entryKind(f.route);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(f);
  }

  // stepsBranching preserves every fan-out (e.g. success/failure); fall back to the flat
  // `steps` list (single lane, one per column) when a flow has no branching data.
  const positionedSteps: PositionedStep[] = selectedFlow.stepsBranching
    ? layoutBranching(selectedFlow.stepsBranching)
    : (selectedFlow.steps ?? []).map((id, i) => ({ unit: id, col: i + 1, row: 0, parent: i === 0 ? selectedFlow.id : (selectedFlow.steps![i - 1] ?? selectedFlow.id) }));

  const stepByUnitId = new Map(positionedSteps.map((p) => [p.unit, p]));
  const steps = positionedSteps.map((p) => unitsById.get(p.unit)).filter((u): u is Unit => Boolean(u));

  // Route contract node (col 0) then one step per column, left to right — mirrors the
  // mock's graph-node chain (docs/mock renderFlowsMode) instead of a stacked card list.
  const nodeY = 40;
  const routeX = 0;
  const stepX = (col: number) => col * (NODE_W + COL_GAP);
  const stepY = (row: number) => nodeY + row * ROW_H;
  const maxCol = Math.max(0, ...positionedSteps.map((p) => p.col));
  const maxRow = Math.max(0, ...positionedSteps.map((p) => p.row));
  const canvasW = stepX(maxCol) + NODE_W + 40;
  const canvasH = stepY(maxRow) + ROW_H + nodeY;

  const connectorEdges: { x1: number; y1: number; x2: number; y2: number; kind: "call" | "import"; label?: string; from: string; to: string }[] = [];
  for (const step of positionedSteps) {
    if (step.parent === null) continue;
    const parentPos = step.parent === selectedFlow.id ? { col: 0, row: maxRow / 2 } : stepByUnitId.get(step.parent);
    if (!parentPos) continue;
    const kind = edgeKind(edges, step.parent, step.unit);
    connectorEdges.push({
      x1: stepX(parentPos.col) + NODE_W,
      y1: stepY(parentPos.row) + ROW_H / 2,
      x2: stepX(step.col),
      y2: stepY(step.row) + ROW_H / 2,
      kind: kind === "calls" ? "call" : "import",
      label: step.label ?? kind,
      from: step.parent,
      to: step.unit,
    });
  }

  return (
    <div className="flows" style={{ flex: 1, minWidth: 0, display: "flex", overflow: "hidden" }}>
      <Tray title={`Entry points · ${flows.length}`}>
        {[...groups.entries()].map(([kind, group]) => (
          <div key={kind} style={{ marginBottom: 8 }}>
            <div style={{ font: "var(--type-label)", textTransform: "uppercase", letterSpacing: "var(--tracking-caps)", color: "var(--text-faint)", margin: "12px 0 4px" }}>
              {kind}
            </div>
            {group.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setSelectedFlowId(f.id)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "7px 8px",
                  marginBottom: 4,
                  background: f.id === selectedFlow.id ? "var(--surface-3)" : "var(--surface-2)",
                  color: "var(--text-hi)",
                  border: "var(--border-w) solid var(--border-hair)",
                  borderRadius: "var(--radius-xs)",
                  cursor: "pointer",
                  font: "inherit",
                }}
              >
                <b style={{ display: "block", fontSize: "var(--text-base)" }}>{f.route ?? f.name}</b>
                <em style={{ fontStyle: "normal", fontSize: 9, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {f.metrics.hops ?? (f.steps?.length ?? 0)} hops
                </em>
              </button>
            ))}
          </div>
        ))}
      </Tray>

      <div className="flows-path" style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
        <GraphCanvas style={{ width: canvasW, height: canvasH, minWidth: "100%", minHeight: "100%" }}>
          <ConnectorLayer edges={connectorEdges} route="ortho" arrows />
          <div
            className="flow-node flow-node-contract"
            style={{
              position: "absolute",
              left: routeX,
              top: stepY(maxRow / 2),
              width: NODE_W,
              minHeight: ROW_H * 0.6,
              padding: "10px 14px",
              background: "var(--surface-2)",
              border: "var(--border-w) solid var(--temp-4)",
              borderRadius: "var(--radius-md)",
              color: "var(--text-hi)",
              font: "var(--weight-semibold) var(--text-sm) var(--font-core)",
            }}
          >
            {selectedFlow.route ?? selectedFlow.name}
          </div>
          {steps.map((step) => {
            const pos = stepByUnitId.get(step.id)!;
            const changed = changedStepIds?.has(step.id) ?? false;
            return (
              <div
                key={step.id}
                className="flow-step"
                onClick={() => onSelectStep(step.id)}
                style={{
                  position: "absolute",
                  left: stepX(pos.col),
                  top: stepY(pos.row),
                  width: NODE_W,
                  minHeight: ROW_H * 0.6,
                  padding: "10px 14px",
                  background: "var(--surface-2)",
                  border: `var(--border-w) solid ${changed ? "var(--temp-6)" : "var(--border-1)"}`,
                  borderRadius: "var(--radius-md)",
                  color: "var(--text-hi)",
                  cursor: "pointer",
                  transition: "border-color 150ms ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <b style={{ font: "var(--weight-semibold) var(--text-sm) var(--font-core)" }}>{step.name}</b>
                  {changed && <Badge tone="mod">changed</Badge>}
                </div>
                <div style={{ font: "var(--type-metric)", color: "var(--text-faint)", marginTop: 4 }}>
                  {step.loc.files[0]} · {step.loc.sloc} sloc
                  {step.cost?.complexity !== undefined && ` · complexity ${step.cost.complexity}`}
                </div>
                {step.semantics?.what && <p style={{ fontSize: 11, margin: "4px 0 0", color: "var(--text-body)" }}>{step.semantics.what}</p>}
              </div>
            );
          })}
        </GraphCanvas>
      </div>
    </div>
  );
}

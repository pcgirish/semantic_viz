import { useState } from "react";
import { Badge, Card, Tray } from "@scv/design-system";
import type { Edge, Unit } from "@scv/schema";

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

  const steps = (selectedFlow.steps ?? []).map((id) => unitsById.get(id)).filter((u): u is Unit => Boolean(u));

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

      <div className="flows-path" style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: 20 }}>
        {steps.map((step, i) => {
          const next = steps[i + 1];
          const changed = changedStepIds?.has(step.id) ?? false;
          return (
            <div key={step.id}>
              <Card className="flow-step" tone={changed ? "warm" : "neutral"} onClick={() => onSelectStep(step.id)} style={{ cursor: "pointer", marginBottom: 8 }}>
                <div style={{ display: "flex", gap: 10 }}>
                  <span style={{ font: "600 11px var(--type-mono, monospace)", color: "var(--text-faint)", flex: "none" }}>{i + 1}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <b>{step.name}</b>
                      {changed && <Badge tone="mod">changed</Badge>}
                    </div>
                    <div style={{ font: "var(--type-metric)", color: "var(--text-faint)", marginTop: 2 }}>
                      {step.loc.files[0]} · {step.loc.sloc} sloc
                      {step.cost?.complexity !== undefined && ` · complexity ${step.cost.complexity}`}
                    </div>
                    {step.semantics?.what && <p style={{ fontSize: 11, margin: "4px 0 0" }}>{step.semantics.what}</p>}
                  </div>
                </div>
              </Card>
              {next && (
                <div className="flow-edge" style={{ font: "var(--type-metric)", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.06em", padding: "4px 0 4px 40px" }}>
                  {edgeKind(edges, step.id, next.id) ?? "→"}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

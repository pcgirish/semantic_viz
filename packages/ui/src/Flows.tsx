import { useState } from "react";
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
    return <div className="flows-empty">No entry points recorded for this snapshot.</div>;
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
    <div className="flows">
      <nav className="flows-rail">
        <h3>Entry points · {flows.length}</h3>
        {[...groups.entries()].map(([kind, group]) => (
          <div key={kind} className="flows-group">
            <div className="flows-group-label">{kind}</div>
            {group.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`flows-entry${f.id === selectedFlow.id ? " sel" : ""}`}
                onClick={() => setSelectedFlowId(f.id)}
              >
                <b>{f.route ?? f.name}</b>
                <em>{f.metrics.hops ?? (f.steps?.length ?? 0)} hops</em>
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="flows-path">
        {steps.map((step, i) => {
          const next = steps[i + 1];
          const changed = changedStepIds?.has(step.id) ?? false;
          return (
            <div key={step.id}>
              <div
                className={`flow-step${changed ? " changed" : ""}`}
                onClick={() => onSelectStep(step.id)}
              >
                <span className="flow-step-index">{i + 1}</span>
                <div className="flow-step-body">
                  <div className="flow-step-head">
                    <b>{step.name}</b>
                    {changed && <span className="flow-step-dot" aria-label="changed" />}
                  </div>
                  <div className="flow-step-meta">
                    {step.loc.files[0]} · {step.loc.sloc} sloc
                    {step.cost?.complexity !== undefined && ` · complexity ${step.cost.complexity}`}
                  </div>
                  {step.semantics?.what && <p className="flow-step-what">{step.semantics.what}</p>}
                </div>
              </div>
              {next && (
                <div className="flow-edge">{edgeKind(edges, step.id, next.id) ?? "→"}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

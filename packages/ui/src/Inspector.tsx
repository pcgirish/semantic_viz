import { Badge, Card, RiskMeter, Tray } from "@scv/design-system";
import type { Edge, External, Unit } from "@scv/schema";

export type InspectorProps = {
  unit: Unit | null;
  units: Unit[];
  edges: Edge[];
  /** Present when the Depends-on view has an external selected (docs/serve.md#4 "Depends on"
   *  — "selecting an external lists every unit that reaches it and why it is present"). Takes
   *  priority over `unit` when both are set, since the two selections are mutually exclusive
   *  in practice (only one view is active at a time). */
  external?: External | null;
};

const LOW_CONFIDENCE = 0.6;

function fileOf(unit: Unit): string | undefined {
  return unit.loc.files[0];
}

/**
 * Right tray, always present, follows selection. Renders every Unit field per
 * docs/serve.md#5. semantics/cost are Interpreter-owned and may be null (no Interpreter
 * pass exists yet) — that state is shown explicitly rather than left blank, matching the
 * doc's rule that "empty states carry information rather than apologising."
 */
export function Inspector({ unit, units, edges, external }: InspectorProps): JSX.Element {
  if (external) {
    const reachedBy = external.reached_by.map((id) => units.find((u) => u.id === id)).filter((u): u is Unit => Boolean(u));
    return (
      <Tray title={external.name} dock="right">
        <div className="meta" style={{ display: "flex", gap: 8, font: "var(--type-metric)", color: "var(--text-faint)", marginBottom: 12 }}>
          <span>{external.id}</span>
          <span>{external.ecosystem}</span>
        </div>
        <ul className="tags" style={{ display: "flex", gap: 6, listStyle: "none", padding: 0, margin: "0 0 12px" }}>
          <li>
            <Badge>depth {external.depth}</Badge>
          </li>
          <li>
            <Badge>{external.direct ? "direct" : "transitive"}</Badge>
          </li>
        </ul>
        <Card title="Reach">
          <dl>
            <dt>Version</dt>
            <dd>{external.version}</dd>
            <dt>Call sites</dt>
            <dd>{external.reached_by.length}</dd>
            <dt>Transitive</dt>
            <dd>{external.transitive_count ?? "not computed"}</dd>
          </dl>
        </Card>
        <Card title="Reached by">
          {reachedBy.length > 0 ? (
            <ul>
              {reachedBy.map((u) => (
                <li key={u.id}>{u.name}</li>
              ))}
            </ul>
          ) : (
            <p>Nothing resolved — the unit that reaches this dependency isn't in this snapshot.</p>
          )}
        </Card>
      </Tray>
    );
  }

  if (!unit) {
    return (
      <Tray title="Inspector" dock="right">
        Nothing selected.
      </Tray>
    );
  }

  const dependsOn = edges.filter((e) => e.from === unit.id).map((e) => units.find((u) => u.id === e.to)).filter((u): u is Unit => Boolean(u));
  const usedBy = edges.filter((e) => e.to === unit.id).map((e) => units.find((u) => u.id === e.from)).filter((u): u is Unit => Boolean(u));

  const semanticsConfidence = unit.semantics?.confidence;
  const lowConfidence = semanticsConfidence !== undefined && semanticsConfidence < LOW_CONFIDENCE;

  return (
    <Tray title={unit.name} dock="right">
      <div className="meta" style={{ display: "flex", gap: 8, font: "var(--type-metric)", color: "var(--text-faint)", marginBottom: 12 }}>
        <span>{unit.id}</span>
        <span>{unit.kind}</span>
        {fileOf(unit) && <span>{fileOf(unit)}</span>}
      </div>

      {unit.tags.length > 0 && (
        <ul className="tags" style={{ display: "flex", gap: 6, flexWrap: "wrap", listStyle: "none", padding: 0, margin: "0 0 12px" }}>
          {unit.tags.map((t) => (
            <li key={t}>
              <Badge>{t}</Badge>
            </li>
          ))}
        </ul>
      )}

      <Card title="Signature">
        {unit.signature ? (
          <div>
            <div>in: {unit.signature.in.map((p) => p.name).join(", ") || "—"}</div>
            <div>out: {unit.signature.out.map((p) => p.name).join(", ") || "—"}</div>
            <div>raises: {unit.signature.raises.join(", ") || "—"}</div>
          </div>
        ) : (
          <p>No signature.</p>
        )}
      </Card>

      <Card title="What / how / when / where / why" tone={lowConfidence ? "warm" : "neutral"} className={lowConfidence ? "low-confidence" : undefined}>
        {unit.semantics ? (
          <>
            <dl className="semantics" style={{ display: "grid", gridTemplateColumns: "42px 1fr", gap: "4px 9px" }}>
              <dt>what</dt>
              <dd>{unit.semantics.what}</dd>
              <dt>how</dt>
              <dd>{unit.semantics.how}</dd>
              <dt>when</dt>
              <dd>{unit.semantics.when}</dd>
              <dt>where</dt>
              <dd>{unit.semantics.where}</dd>
              <dt>why</dt>
              <dd>{unit.semantics.why}</dd>
            </dl>
            <RiskMeter value={unit.semantics.confidence * 7} label={`confidence: ${Math.round(unit.semantics.confidence * 100)}% (${unit.semantics.source})`} />
          </>
        ) : (
          <p>Not yet available — no Interpreter pass has run on this snapshot.</p>
        )}
      </Card>

      <Card title="Metrics">
        <dl>
          <dt>sloc</dt>
          <dd>{unit.metrics.sloc ?? unit.loc.sloc}</dd>
          <dt>fan in</dt>
          <dd>{unit.metrics.fan_in ?? "—"}</dd>
          <dt>fan out</dt>
          <dd>{unit.metrics.fan_out ?? "—"}</dd>
          <dt>complexity</dt>
          <dd>{unit.cost?.complexity ?? "—"}</dd>
          <dt>I/O</dt>
          <dd>{unit.cost?.io?.join(", ") || "—"}</dd>
          <dt>cost estimate</dt>
          <dd>{unit.cost?.estimate ?? "Not yet available"}</dd>
          <dt>churn</dt>
          <dd>{unit.metrics.churn ?? "—"}</dd>
        </dl>
      </Card>

      <Card title="Depends on">
        {dependsOn.length > 0 ? (
          <ul>
            {dependsOn.map((u) => (
              <li key={u.id}>{u.name}</li>
            ))}
          </ul>
        ) : (
          <p>Nothing. This unit calls out to nothing.</p>
        )}
      </Card>

      <Card title="Used by">
        {usedBy.length > 0 ? (
          <ul>
            {usedBy.map((u) => (
              <li key={u.id}>{u.name}</li>
            ))}
          </ul>
        ) : (
          <p>Nothing. Removing this is free — or it is orphaned.</p>
        )}
      </Card>
    </Tray>
  );
}

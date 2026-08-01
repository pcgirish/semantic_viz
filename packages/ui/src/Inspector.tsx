import type { Edge, Unit } from "@scv/schema";

export type InspectorProps = {
  unit: Unit | null;
  units: Unit[];
  edges: Edge[];
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
export function Inspector({ unit, units, edges }: InspectorProps): JSX.Element {
  if (!unit) {
    return <aside className="inspector">Nothing selected.</aside>;
  }

  const dependsOn = edges.filter((e) => e.from === unit.id).map((e) => units.find((u) => u.id === e.to)).filter((u): u is Unit => Boolean(u));
  const usedBy = edges.filter((e) => e.to === unit.id).map((e) => units.find((u) => u.id === e.from)).filter((u): u is Unit => Boolean(u));

  const semanticsConfidence = unit.semantics?.confidence;
  const lowConfidence = semanticsConfidence !== undefined && semanticsConfidence < LOW_CONFIDENCE;

  return (
    <aside className="inspector">
      <h2>{unit.name}</h2>
      <div className="meta">
        <span>{unit.id}</span>
        <span>{unit.kind}</span>
        {fileOf(unit) && <span>{fileOf(unit)}</span>}
      </div>

      {unit.tags.length > 0 && (
        <ul className="tags">
          {unit.tags.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}

      <section>
        <h3>Signature</h3>
        {unit.signature ? (
          <div>
            <div>in: {unit.signature.in.map((p) => p.name).join(", ") || "—"}</div>
            <div>out: {unit.signature.out.map((p) => p.name).join(", ") || "—"}</div>
            <div>raises: {unit.signature.raises.join(", ") || "—"}</div>
          </div>
        ) : (
          <p>No signature.</p>
        )}
      </section>

      <section className={lowConfidence ? "low-confidence" : undefined}>
        <h3>What / how / when / where / why</h3>
        {unit.semantics ? (
          <>
            <p>{unit.semantics.what}</p>
            <p>{unit.semantics.how}</p>
            <p>{unit.semantics.when}</p>
            <p>{unit.semantics.where}</p>
            <p>{unit.semantics.why}</p>
            <p className="confidence">
              confidence: {Math.round(unit.semantics.confidence * 100)}% ({unit.semantics.source})
            </p>
          </>
        ) : (
          <p>Not yet available — no Interpreter pass has run on this snapshot.</p>
        )}
      </section>

      <section>
        <h3>Metrics</h3>
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
      </section>

      <section>
        <h3>Depends on</h3>
        {dependsOn.length > 0 ? (
          <ul>
            {dependsOn.map((u) => (
              <li key={u.id}>{u.name}</li>
            ))}
          </ul>
        ) : (
          <p>Nothing. This unit calls out to nothing.</p>
        )}
      </section>

      <section>
        <h3>Used by</h3>
        {usedBy.length > 0 ? (
          <ul>
            {usedBy.map((u) => (
              <li key={u.id}>{u.name}</li>
            ))}
          </ul>
        ) : (
          <p>Nothing. Removing this is free — or it is orphaned.</p>
        )}
      </section>
    </aside>
  );
}

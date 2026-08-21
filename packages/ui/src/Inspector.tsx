import { Badge, Card, RiskMeter, Tray } from "@scv/design-system";
import type { Delta, Edge, External, Unit } from "@scv/schema";

export type InspectorProps = {
  unit: Unit | null;
  units: Unit[];
  edges: Edge[];
  /** Present when the Depends-on view has an external selected (docs/serve.md#4 "Depends on"
   *  — "selecting an external lists every unit that reaches it and why it is present"). Takes
   *  priority over `unit` when both are set, since the two selections are mutually exclusive
   *  in practice (only one view is active at a time). */
  external?: External | null;
  /** Delta mode's ranked flagged units (docs/serve.md#4 "Delta" — "the inspect queue is
   *  the primary interface"). Shown as a summary here only while nothing is selected yet,
   *  so the tray answers "what deserves a look" before the user has picked anything. */
  deltaQueue?: Delta["inspect_queue"];
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
type Dependency = { edgeId: string; unit: Unit; rollupCount: number | null };

/**
 * A rolled-up edge stands for many concrete ones, and its summed `weight` says nothing a reader
 * can act on. `rollupProvenance.count` does — "14 calls", not "weight 20". Absent on a legacy
 * rollup written before the field existed, which renders as a plain name rather than a guess.
 */
function dependencyLabel(d: Dependency): string {
  return d.rollupCount === null ? d.unit.name : `${d.unit.name} (${d.rollupCount} calls)`;
}

export function Inspector({ unit, units, edges, external, deltaQueue }: InspectorProps): JSX.Element {
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
    if (deltaQueue && deltaQueue.length > 0) {
      return (
        <Tray title="Inspector" dock="right">
          <Card title="Deserves inspection">
            <ul style={{ display: "flex", flexDirection: "column", gap: 6, listStyle: "none", padding: 0, margin: 0 }}>
              {deltaQueue.map((e) => (
                <li key={e.unit}>
                  <strong>{e.qualname}</strong>
                  <div style={{ color: "var(--text-dim)", fontSize: "var(--text-xs)" }}>risk {Math.round(e.risk * 100)}%</div>
                  <div style={{ color: "var(--text-faint)", fontSize: "var(--text-xs)" }}>{e.status}</div>
                </li>
              ))}
            </ul>
          </Card>
          <p style={{ color: "var(--text-dim)", fontSize: "var(--text-xs)", padding: "8px 4px" }}>
            Select any node to see its full risk breakdown and change summary.
          </p>
        </Tray>
      );
    }
    return (
      <Tray title="Inspector" dock="right">
        Nothing selected.
      </Tray>
    );
  }

  const dependsOn = edges
    .filter((e) => e.from === unit.id)
    .map((e) => {
      const target = units.find((u) => u.id === e.to);
      return target && { edgeId: e.id, unit: target, rollupCount: e.rollupProvenance?.count ?? null };
    })
    .filter((d): d is Dependency => Boolean(d));
  const usedBy = edges
    .filter((e) => e.to === unit.id)
    .map((e) => {
      const source = units.find((u) => u.id === e.from);
      return source && { edgeId: e.id, unit: source, rollupCount: e.rollupProvenance?.count ?? null };
    })
    .filter((d): d is Dependency => Boolean(d));

  const semanticsConfidence = unit.semantics?.confidence;
  const lowConfidence = semanticsConfidence !== undefined && semanticsConfidence < LOW_CONFIDENCE;

  return (
    <Tray title={unit.name} dock="right">
      <div className="meta" style={{ display: "flex", gap: 8, font: "var(--type-metric)", color: "var(--text-faint)", marginBottom: 12 }}>
        <span>{unit.id}</span>
        <span>{unit.kind}</span>
        {fileOf(unit) && <span>{fileOf(unit)}</span>}
      </div>

      {(unit.tags.length > 0 || semanticsConfidence !== undefined || (unit.authors?.length ?? 0) > 0) && (
        <ul className="tags" style={{ display: "flex", gap: 6, flexWrap: "wrap", listStyle: "none", padding: 0, margin: "0 0 12px" }}>
          {semanticsConfidence !== undefined && (
            <li>
              <Badge tone={lowConfidence ? "risk" : "cool"}>conf {semanticsConfidence.toFixed(2)}</Badge>
            </li>
          )}
          {[...(unit.authors ?? [])]
            .sort((a, b) => b.lines - a.lines)
            .map((a) => (
              <li key={a.name}>
                <Badge title={`${a.lines} lines`}>{a.name}</Badge>
              </li>
            ))}
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
            {dependsOn.map((d) => (
              <li key={d.edgeId}>{dependencyLabel(d)}</li>
            ))}
          </ul>
        ) : (
          <p>Nothing. This unit calls out to nothing.</p>
        )}
      </Card>

      <Card title="Used by">
        {usedBy.length > 0 ? (
          <ul>
            {usedBy.map((d) => (
              <li key={d.edgeId}>{dependencyLabel(d)}</li>
            ))}
          </ul>
        ) : (
          <p>Nothing. Removing this is free — or it is orphaned.</p>
        )}
      </Card>
    </Tray>
  );
}

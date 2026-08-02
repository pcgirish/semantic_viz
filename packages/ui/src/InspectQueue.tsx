import type { Delta } from "@scv/schema";

export type InspectQueueProps = {
  entries: Delta["inspect_queue"];
  onSelect: (unitId: string) => void;
};

const LOW_CONFIDENCE = 0.6;

/**
 * Delta mode's primary interface (docs/serve.md#4 "Delta" — "The inspect queue is the
 * primary interface in this mode"). Ranked by the Interpreter's judgment, not by
 * risk.score (docs/analyze.md#rank-is-not-score) — rank order is rendered as given.
 */
export function InspectQueue({ entries, onSelect }: InspectQueueProps): JSX.Element {
  return (
    <aside className="inspect-queue" data-testid="inspect-queue">
      <h2>Inspect queue</h2>
      <ol>
        {entries.map((e) => (
          <li
            key={e.unit}
            className={e.confidence < LOW_CONFIDENCE ? "low-confidence" : undefined}
            onClick={() => onSelect(e.unit)}
          >
            <span className="rank">{e.rank}</span>
            <span className="qualname">{e.qualname}</span>
            <span className="status">{e.status}</span>
            <span className="risk">risk {e.risk.toFixed(2)}</span>
            <span className="confidence">conf {Math.round(e.confidence * 100)}%</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

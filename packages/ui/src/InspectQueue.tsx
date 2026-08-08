import { FileRow, Tray } from "@scv/design-system";
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
    <div data-testid="inspect-queue">
      <Tray title="Inspect queue">
        {entries.length === 0 && (
          <p style={{ color: "var(--text-faint)", fontSize: 11.5, fontStyle: "italic" }}>
            No delta available for this revision.
          </p>
        )}
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {entries.map((e) => (
            <li
              key={e.unit}
              className={e.confidence < LOW_CONFIDENCE ? "low-confidence" : undefined}
              style={{
                marginBottom: 4,
                borderLeft: e.confidence < LOW_CONFIDENCE ? "3px dashed var(--modified)" : "3px solid transparent",
              }}
            >
              <FileRow
                name={`${e.rank}. ${e.qualname}`}
                path={`${e.status} · risk ${e.risk.toFixed(2)} · conf ${Math.round(e.confidence * 100)}%`}
                temp={Math.round(e.risk * 7)}
                onClick={() => onSelect(e.unit)}
              />
            </li>
          ))}
        </ol>
      </Tray>
    </div>
  );
}

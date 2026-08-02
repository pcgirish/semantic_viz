import type { External } from "@scv/schema";

export type DependsOnProps = {
  externals: External[];
  onSelect: (id: string) => void;
};

const ROW_HEIGHT = 140;
const BASE_RADIUS = 22;
const RADIUS_SCALE = 8;

/**
 * Depends-on view: externals in rows by depth — direct at the top, transitive below —
 * sized by transitive_count (docs/serve.md#4 "Depends on"). A separate view, not a filter:
 * "reading downward is reading how far your supply chain reaches."
 */
export function DependsOn({ externals, onSelect }: DependsOnProps): JSX.Element {
  if (externals.length === 0) {
    return <div className="depends-on-empty">No external dependencies recorded for this snapshot.</div>;
  }

  const depths = [...new Set(externals.map((x) => x.depth))].sort((a, b) => a - b);

  return (
    <div className="depends-on">
      {depths.map((depth) => {
        const row = externals.filter((x) => x.depth === depth);
        return (
          <div key={depth} className="dep-row" data-depth={depth} style={{ height: ROW_HEIGHT }}>
            <div className="dep-row-label">
              depth {depth} · {row[0]!.direct ? "direct" : "transitive"}
            </div>
            <svg className="dep-row-canvas" viewBox={`0 0 ${row.length * ROW_HEIGHT} ${ROW_HEIGHT}`}>
              {row.map((x, i) => {
                const cx = i * ROW_HEIGHT + ROW_HEIGHT / 2;
                const cy = ROW_HEIGHT / 2;
                const r = BASE_RADIUS + Math.sqrt(x.transitive_count ?? 1) * RADIUS_SCALE;
                return (
                  <g key={x.id} className="dep-ext" data-ext={x.id} onClick={() => onSelect(x.id)}>
                    <circle cx={cx} cy={cy} r={r} />
                    <text x={cx} y={cy + 4} textAnchor="middle" className="dep-name">
                      {x.name}
                    </text>
                    <text x={cx} y={cy + r + 14} textAnchor="middle" className="dep-meta">
                      {x.version} · {x.reached_by.length} call site{x.reached_by.length === 1 ? "" : "s"}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        );
      })}
    </div>
  );
}

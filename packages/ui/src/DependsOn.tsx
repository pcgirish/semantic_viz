import { BubbleChart } from "@scv/design-system";
import type { External } from "@scv/schema";

export type DependsOnProps = {
  externals: External[];
  onSelect: (id: string) => void;
};

/**
 * Depends-on view: externals in bands by depth — direct at the top, transitive below —
 * sized by transitive_count (docs/serve.md#4 "Depends on"). A separate view, not a filter:
 * "reading downward is reading how far your supply chain reaches."
 */
export function DependsOn({ externals, onSelect }: DependsOnProps): JSX.Element {
  if (externals.length === 0) {
    return (
      <div
        className="depends-on-empty"
        style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)", fontSize: 12 }}
      >
        No external dependencies recorded for this snapshot.
      </div>
    );
  }

  const depths = [...new Set(externals.map((x) => x.depth))].sort((a, b) => a - b);

  return (
    <div className="depends-on" style={{ flex: 1, minWidth: 0, overflowY: "auto", background: "var(--surface-0)" }}>
      {depths.map((depth) => {
        const row = externals.filter((x) => x.depth === depth);
        return (
          <div
            key={depth}
            className="dep-row"
            data-depth={depth}
            style={{ borderBottom: "var(--border-w) solid var(--border-hair)" }}
          >
            <BubbleChart
              bands={[
                {
                  label: `depth ${depth} · ${row[0]!.direct ? "direct" : "transitive"}`,
                  items: row.map((x) => ({
                    id: x.id,
                    label: `${x.name}\n${x.version} · ${x.reached_by.length} call site${x.reached_by.length === 1 ? "" : "s"}`,
                    count: x.transitive_count ?? 1,
                    unit: "transitive",
                  })),
                },
              ]}
              onSelect={onSelect}
            />
          </div>
        );
      })}
    </div>
  );
}

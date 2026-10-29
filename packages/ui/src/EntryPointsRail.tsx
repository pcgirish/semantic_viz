import type { CSSProperties } from "react";
import type { External } from "@semviz/schema";

export type EntryPointsRailProps = {
  externals: External[];
  onSelect: (id: string) => void;
};

const railItemStyle: CSSProperties = {
  padding: "var(--space-2) var(--space-3)",
  background: "var(--surface-2)",
  borderRadius: "var(--radius-md)",
  border: "var(--border-w) solid var(--border-1)",
  cursor: "pointer",
  fontSize: "var(--text-xs)",
  color: "var(--text-body)",
};

/**
 * Depends-on rail: external dependencies as clickable rows (docs mock's renderRail
 * 'depends' branch) — the rail lists what to select, BubbleChart in the canvas shows
 * depth/size once selected. The enclosing Tray supplies the heading.
 */
export function EntryPointsRail({ externals, onSelect }: EntryPointsRailProps): JSX.Element {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {externals.map((e) => (
        <div key={e.id} style={railItemStyle} onClick={() => onSelect(e.id)}>
          <strong>{e.name}</strong>
          <br />
          <small style={{ color: "var(--text-dim)" }}>v{e.version}</small>
          <br />
          <small style={{ color: "var(--text-faint)" }}>{e.reached_by.length} call sites</small>
        </div>
      ))}
    </div>
  );
}

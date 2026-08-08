import type { CSSProperties } from "react";
import type { External } from "@scv/schema";

export type EntryPointsRailProps = {
  externals: External[];
  onSelect: (id: string) => void;
};

const railLabelStyle: CSSProperties = {
  font: "var(--weight-semibold) var(--text-xs) var(--font-core)",
  color: "var(--text-faint)",
  textTransform: "uppercase",
  letterSpacing: "0.09em",
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
 * Depends-on rail: externals as clickable entry points (docs mock's renderRail
 * 'depends' branch) — the rail lists what to select, BubbleChart in the canvas shows
 * depth/size once selected.
 */
export function EntryPointsRail({ externals, onSelect }: EntryPointsRailProps): JSX.Element {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <div style={railLabelStyle}>Entry Points</div>
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

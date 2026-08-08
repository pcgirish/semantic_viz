import React from "react";
import { Icon } from "./Icon.jsx";

/** Mode switcher — graph / diff / timeline, 2D / 3D. */
export function SegmentedControl({ value, onChange, options = [], size = "md", style }) {
  const h = size === "sm" ? 24 : 30;
  return (
    <div style={{
      display: "inline-flex", padding: 2, gap: 2, height: h + 4,
      background: "var(--surface-sunken)", border: "var(--border-w) solid var(--border-hair)",
      borderRadius: "var(--radius-sm)", ...style
    }}>
      {options.map(o => {
        const v = o.value ?? o, on = v === value;
        return (
          <button key={v} type="button" onClick={() => onChange && onChange(v)} style={{
            display: "inline-flex", alignItems: "center", gap: 6, height: h, padding: "0 10px",
            background: on ? "var(--surface-3)" : "transparent",
            color: on ? "var(--text-hi)" : "var(--text-dim)",
            border: "var(--border-w) solid " + (on ? "var(--border-1)" : "transparent"),
            borderRadius: "var(--radius-xs)", font: "var(--type-ui)",
            fontSize: size === "sm" ? "var(--text-xs)" : "var(--text-base)", cursor: "pointer",
            transition: "background var(--t-hover),color var(--t-hover)"
          }}>
            {o.icon && <Icon name={o.icon} size={14} />}
            {o.label ?? v}
          </button>
        );
      })}
    </div>
  );
}

import React from "react";

/** Layer toggle. Track turns accent when on. */
export function Switch({ checked, onChange, label, disabled, style }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? .45 : 1, ...style }}>
      <span onClick={() => !disabled && onChange && onChange(!checked)} style={{
        width: 30, height: 16, padding: 2, display: "flex", alignItems: "center",
        background: checked ? "var(--cool-cyan-dim)" : "var(--ink-750)",
        border: "var(--border-w) solid " + (checked ? "var(--cool-cyan)" : "var(--border-1)"),
        borderRadius: "var(--radius-pill)", transition: "background var(--t-hover)"
      }}>
        <span style={{
          width: 10, height: 10, borderRadius: "50%",
          background: checked ? "var(--cool-cyan-lift)" : "var(--text-faint)",
          transform: checked ? "translateX(14px)" : "none",
          transition: "transform var(--dur-2) var(--ease-snap),background var(--t-hover)"
        }} />
      </span>
      {label && <span style={{ font: "var(--type-ui)", color: "var(--text-body)" }}>{label}</span>}
    </label>
  );
}

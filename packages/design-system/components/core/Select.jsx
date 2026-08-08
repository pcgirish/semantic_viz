import React from "react";
import { Icon } from "./Icon.jsx";

/** Compact native select styled as a hairline control. */
export function Select({ value, onChange, options = [], size = "md", label, style, ...rest }) {
  const h = size === "sm" ? 26 : 32;
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, ...style }}>
      {label && <span className="cd-mono-caps">{label}</span>}
      <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
        <select value={value} onChange={onChange} {...rest} style={{
          appearance: "none", height: h, padding: "0 26px 0 10px",
          background: "var(--surface-2)", color: "var(--text-hi)",
          border: "var(--border-w) solid var(--border-1)", borderRadius: "var(--radius-sm)",
          font: "var(--type-ui)", fontSize: size === "sm" ? "var(--text-xs)" : "var(--text-base)", cursor: "pointer"
        }}>
          {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
        </select>
        <Icon name="chevron-down" size={13} style={{ position: "absolute", right: 8, background: "var(--text-faint)", pointerEvents: "none" }} />
      </span>
    </label>
  );
}

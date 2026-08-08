import React from "react";
import { Icon } from "./Icon.jsx";

/** Hairline text field. Monospace variant for paths, SHAs and queries. */
export function Input({ value, onChange, placeholder, icon, mono, size = "md", suffix, invalid, disabled, style, ...rest }) {
  const h = size === "sm" ? 26 : size === "lg" ? 38 : 32;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, height: h, padding: "0 10px",
      background: "var(--surface-sunken)",
      border: `var(--border-w) solid ${invalid ? "var(--temp-6)" : "var(--border-1)"}`,
      borderRadius: "var(--radius-sm)", boxShadow: "var(--inset-well)",
      opacity: disabled ? .5 : 1, ...style
    }}>
      {icon && <Icon name={icon} size={14} style={{ background: "var(--text-faint)" }} />}
      <input value={value} onChange={onChange} placeholder={placeholder} disabled={disabled}
        style={{
          flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none",
          color: "var(--text-hi)", font: mono ? "var(--type-code)" : "var(--type-ui)",
          fontSize: size === "sm" ? "var(--text-xs)" : "var(--text-base)"
        }} {...rest} />
      {suffix && <span style={{ font: "var(--type-metric)", color: "var(--text-faint)" }}>{suffix}</span>}
    </div>
  );
}

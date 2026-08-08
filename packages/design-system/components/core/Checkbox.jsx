import React from "react";
import { Icon } from "./Icon.jsx";

/** Square checkbox with a chamfered box. */
export function Checkbox({ checked, onChange, label, disabled, style }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? .45 : 1, ...style }}>
      <input type="checkbox" checked={!!checked} onChange={onChange} disabled={disabled} style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
      <span style={{
        width: 15, height: 15, display: "grid", placeItems: "center",
        background: checked ? "var(--cool-cyan)" : "var(--surface-sunken)",
        border: "var(--border-w) solid " + (checked ? "var(--cool-cyan)" : "var(--border-2)"),
        clipPath: "var(--clip-chamfer-sm)", transition: "background var(--t-hover)"
      }}>
        {checked && <Icon name="check" size={11} style={{ background: "var(--text-inverse)" }} />}
      </span>
      {label && <span style={{ font: "var(--type-ui)", color: "var(--text-body)" }}>{label}</span>}
    </label>
  );
}

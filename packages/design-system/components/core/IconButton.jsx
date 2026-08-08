import React from "react";
import { Icon } from "./Icon.jsx";

const S = { sm: 24, md: 28, lg: 34 };

/** Square icon-only control for rails, toolbars and tray headers. */
export function IconButton({ name, label, size = "md", active, tone = "neutral", disabled, onClick, style, ...rest }) {
  const d = S[size] || S.md;
  const color = active ? "var(--accent-lift)" : tone === "risk" ? "var(--temp-6)" : "var(--text-dim)";
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      style={{
        width: d, height: d, display: "grid", placeItems: "center",
        background: active ? "var(--surface-selected)" : "transparent",
        color, border: "var(--border-w) solid " + (active ? "rgba(31,182,193,.4)" : "transparent"),
        borderRadius: "var(--radius-xs)", cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1, transition: "background var(--t-hover),color var(--t-hover)", ...style
      }}
      onMouseEnter={e => { if (!disabled && !active) { e.currentTarget.style.background = "var(--surface-hover)"; e.currentTarget.style.color = "var(--text-hi)"; } }}
      onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = color; } }}
      {...rest}>
      <Icon name={name} size={size === "lg" ? 18 : 15} />
    </button>
  );
}

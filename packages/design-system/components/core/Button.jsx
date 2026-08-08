import React from "react";

const TONE = {
  accent: { bg: "var(--cool-cyan)", fg: "var(--text-inverse)", bd: "var(--cool-cyan)" },
  neutral: { bg: "var(--ink-800)", fg: "var(--text-hi)", bd: "var(--border-1)" },
  warm: { bg: "var(--temp-4)", fg: "#1A1206", bd: "var(--temp-4)" },
  risk: { bg: "var(--temp-6)", fg: "#FFF1F2", bd: "var(--temp-6)" }
};
const SIZE = {
  sm: { h: 26, px: 10, font: "var(--text-xs)" },
  md: { h: 32, px: 14, font: "var(--text-base)" },
  lg: { h: 40, px: 20, font: "var(--text-md)" }
};

/** Faceted action button. Chamfered corners echo the polygon language. */
export function Button({
  children, variant = "solid", tone = "accent", size = "md", faceted = true,
  iconLeft, iconRight, disabled, loading, fullWidth, onClick, type = "button", style, ...rest
}) {
  const t = TONE[tone] || TONE.accent;
  const s = SIZE[size] || SIZE.md;
  const solid = variant === "solid";
  const outline = variant === "outline";
  const base = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    gap: "var(--gap-inline)", height: s.h, padding: `0 ${s.px}px`,
    font: "var(--type-ui)", fontSize: s.font, letterSpacing: "var(--tracking-tight)",
    color: solid ? t.fg : "var(--text-hi)",
    background: faceted && outline ? t.bd : solid ? t.bg : outline ? "transparent" : "var(--surface-hover)",
    border: `var(--border-w) solid ${outline || solid ? t.bd : "transparent"}`,
    borderRadius: faceted ? 0 : "var(--radius-sm)",
    clipPath: faceted ? "var(--clip-chamfer-sm)" : "none",
    boxShadow: solid ? "var(--inset-facet)" : "none",
    cursor: disabled || loading ? "not-allowed" : "pointer",
    opacity: disabled ? 0.42 : 1, width: fullWidth ? "100%" : undefined,
    transition: "background var(--t-hover),color var(--t-hover),border-color var(--t-hover),transform var(--t-press)",
    whiteSpace: "nowrap", ...style
  };
  return (
    <button type={type} disabled={disabled || loading} onClick={onClick} style={base}
      onMouseDown={e => { if (!disabled) e.currentTarget.style.transform = "translateY(1px)"; }}
      onMouseUp={e => { e.currentTarget.style.transform = "none"; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "none"; }}
      {...rest}>
      {faceted && outline && <span aria-hidden="true" style={{ position: "absolute", inset: 1, clipPath: "var(--clip-chamfer-sm)", background: "var(--surface-0)" }} />}
      {loading ? <span style={{ width: 11, height: 11, border: "1.5px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", animation: "cd-spin 700ms linear infinite" }} /> : iconLeft}
      <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: "var(--gap-inline)" }}>{children}{iconRight}</span>
    </button>
  );
}

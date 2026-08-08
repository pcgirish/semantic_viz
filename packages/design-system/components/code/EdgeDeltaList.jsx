import React from "react";
import { Icon } from "../core/Icon.jsx";

const KIND = {
  added: { icon: "plus", color: "var(--diff-add)", bg: "var(--diff-add-bg)", label: "added" },
  removed: { icon: "minus", color: "var(--diff-del)", bg: "var(--diff-del-bg)", label: "removed" },
  reweighted: { icon: "gauge", color: "var(--diff-mod)", bg: "var(--diff-mod-bg)", label: "reweighted" }
};

/** One relationship change row: status glyph, from→to pair, optional weight delta. */
export function DeltaRow({ kind = "added", from, to, weightFrom, weightTo, meta, selected, onClick, style }) {
  const k = KIND[kind] || KIND.added;
  const weightChanged = weightFrom != null && weightTo != null && weightFrom !== weightTo;
  return (
    <div onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 8, height: "var(--row-h)", padding: "0 8px",
      background: selected ? "var(--surface-selected)" : "transparent",
      borderLeft: `2px solid ${selected ? "var(--accent)" : "transparent"}`,
      cursor: onClick ? "pointer" : "default", transition: "background var(--t-hover)", ...style
    }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = "var(--surface-hover)"; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = "transparent"; }}>
      <span style={{ width: 15, height: 15, flex: "0 0 auto", display: "grid", placeItems: "center", background: k.bg, color: k.color, borderRadius: "var(--radius-xs)" }}>
        <Icon name={k.icon} size={10} />
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, font: "var(--type-code)", color: "var(--text-body)", whiteSpace: "nowrap", overflow: "hidden" }}>
        <span style={{ color: "var(--text-hi)", overflow: "hidden", textOverflow: "ellipsis" }}>{from}</span>
        <Icon name="arrow-right" size={11} style={{ background: "var(--text-faint)", flex: "0 0 auto" }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{to}</span>
      </span>
      {weightChanged && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, font: "var(--type-metric)", color: "var(--diff-mod)", flex: "0 0 auto" }}>
          {weightFrom}<Icon name="arrow-right" size={9} style={{ background: "var(--diff-mod)" }} />{weightTo}
        </span>
      )}
      {meta && <span style={{ font: "var(--type-metric)", color: "var(--text-faint)", flex: "0 0 auto" }}>{meta}</span>}
    </div>
  );
}

/** Stack of DeltaRows — drop straight inside a Tray, same as FileRow. */
export function EdgeDeltaList({ edges = [], selected, onSelect, style }) {
  return (
    <div style={{ display: "grid", ...style }}>
      {edges.map((e, i) => (
        <DeltaRow key={e.id ?? i} {...e} selected={e.id === selected} onClick={onSelect ? () => onSelect(e.id) : undefined} />
      ))}
    </div>
  );
}

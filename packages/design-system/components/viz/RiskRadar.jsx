import React from "react";
import { tempHex, tempStop } from "./temp.js";

const DEFAULT_AXES = ["functionality", "availability", "scalability", "performance", "security"];

function pt(cx, cy, r, angle) { return [cx + r * Math.sin(angle), cy - r * Math.cos(angle)]; }

/**
 * 5(+)-axis radar chart on the shared 0..7 temperature scale — the multi-dimensional
 * counterpart to RiskMeter's single-axis segments.
 */
export function RiskRadar({ axes = DEFAULT_AXES, values = [], reasons, size = 220, compact, style }) {
  const n = axes.length, cx = size / 2, cy = size / 2, R = size / 2 - (compact ? 20 : 34);
  const rings = [2, 4, 6, 7];
  const worst = Math.max(0, ...values);
  const color = tempHex(worst);
  const poly = values.map((v, i) => pt(cx, cy, (Math.max(0, Math.min(7, v)) / 7) * R, (i / n) * Math.PI * 2)).map(p => p.join(",")).join(" ");
  return (
    <div style={{ display: "grid", gap: compact ? 6 : 12, ...style }}>
      <svg width={size} height={size} style={{ overflow: "visible" }}>
        {rings.map(r => (
          <polygon key={r} points={axes.map((_, i) => pt(cx, cy, (r / 7) * R, (i / n) * Math.PI * 2).join(",")).join(" ")}
            fill="none" stroke="var(--border-hair)" strokeWidth="1" />
        ))}
        {axes.map((a, i) => { const [x, y] = pt(cx, cy, R, (i / n) * Math.PI * 2); return <line key={a} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--border-hair)" strokeWidth="1" />; })}
        <polygon points={poly} fill={color + "30"} stroke={color} strokeWidth="1.5" style={{ transition: "fill var(--t-temp),stroke var(--t-temp)" }} />
        {values.map((v, i) => { const [x, y] = pt(cx, cy, (Math.max(0, Math.min(7, v)) / 7) * R, (i / n) * Math.PI * 2); const c = tempHex(v);
          return <circle key={i} cx={x} cy={y} r={compact ? 2.5 : 3.5} fill={c} stroke="var(--surface-0)" strokeWidth="1" />; })}
        {!compact && axes.map((a, i) => { const [x, y] = pt(cx, cy, R + 16, (i / n) * Math.PI * 2);
          return <text key={a} x={x} y={y + 3} textAnchor="middle" fill="var(--text-faint)" style={{ font: "9px var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{a}</text>; })}
      </svg>
      {!compact && (
        <div style={{ display: "grid", gap: 4 }}>
          {axes.map((a, i) => (
            <div key={a} style={{ display: "flex", justifyContent: "space-between", font: "var(--type-metric)", color: "var(--text-dim)" }}>
              <span style={{ textTransform: "uppercase", letterSpacing: "var(--tracking-caps)" }}>{a}</span>
              <span style={{ color: tempHex(values[i] ?? 0) }}>{values[i] ?? 0}/7 · {tempStop(values[i] ?? 0).label}</span>
            </div>
          ))}
        </div>
      )}
      {!compact && reasons && (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 3, font: "var(--type-metric)", color: "var(--text-dim)" }}>
          {reasons.map((r, i) => <li key={i}>· {r}</li>)}
        </ul>
      )}
    </div>
  );
}

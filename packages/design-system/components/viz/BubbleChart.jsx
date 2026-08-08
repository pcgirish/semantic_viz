import React from "react";
import { tempHex } from "./temp.js";
import { focusRole } from "./focus.js";
import { Tooltip } from "../display/Tooltip.jsx";

/** Simple greedy circle-packing within a band: place left to right, drop to a new row on overflow. */
function packRow(items, bandWidth, gap, minR, maxR, maxCount) {
  const scale = c => minR + (maxR - minR) * Math.sqrt(Math.max(0, c) / (maxCount || 1));
  const rows = [[]];
  let x = 0, rowIdx = 0;
  for (const it of items) {
    const r = scale(it.count);
    if (x + r * 2 > bandWidth && rows[rowIdx].length) { rows.push([]); rowIdx++; x = 0; }
    rows[rowIdx].push({ ...it, r, cx: x + r });
    x += r * 2 + gap;
  }
  return rows;
}

/**
 * Grouped bubble layout: one horizontal band per category (e.g. dependency depth), circles
 * packed left to right within a band. Size encodes count, fill encodes temperature.
 */
export function BubbleChart({ bands = [], width = 660, minR = 10, maxR = 34, gap = 6, rowGap = 10, focus, onSelect, style }) {
  const maxCount = Math.max(1, ...bands.flatMap(b => b.items.map(i => i.count || 0)));
  let y = 0;
  const laidBands = bands.map(band => {
    const rows = packRow(band.items, width, gap, minR, maxR, maxCount);
    const rowHeights = rows.map(r => 2 * Math.max(minR, ...r.map(i => i.r), minR));
    const bandH = rowHeights.reduce((a, b) => a + b + rowGap, -rowGap) || minR * 2;
    const laid = { label: band.label, meta: band.meta, top: y, height: bandH, rows: [] };
    let ry = 0;
    rows.forEach((row, i) => { laid.rows.push({ cy: ry + rowHeights[i] / 2, items: row }); ry += rowHeights[i] + rowGap; });
    y += bandH + 28;
    return laid;
  });
  return (
    <div style={{ position: "relative", width, ...style }}>
      {laidBands.map((band, bi) => (
        <div key={bi} style={{ position: "relative", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
            <span className="cd-mono-caps">{band.label}</span>
            {band.meta && <span style={{ font: "var(--type-metric)", color: "var(--text-faint)" }}>{band.meta}</span>}
            <span style={{ flex: 1, height: 1, background: "var(--border-hair)" }} />
          </div>
          <svg width={width} height={band.height}>
            {band.rows.map((row, ri) => row.items.map((it, ii) => {
              const c = tempHex(it.temp ?? 1);
              const role = focusRole(it.id, focus);
              const dim = role === "muted";
              const solid = role === "self" || it.filled;
              return (
                <g key={ri + "-" + ii} opacity={dim ? "var(--focus-dim)" : 1} style={{ cursor: onSelect ? "pointer" : "default", transition: "opacity var(--t-node)" }}
                  onClick={() => onSelect && onSelect(it.id)}>
                  <circle cx={it.cx} cy={row.cy} r={it.r}
                    fill={solid ? c : c + "35"} stroke={role === "self" ? c : role === "near" ? c + "cc" : c + "80"}
                    strokeWidth={role === "self" ? 2 : 1}
                    style={role === "self" ? { filter: `drop-shadow(0 0 6px ${c}aa)` } : undefined} />
                </g>
              );
            }))}
          </svg>
          {/* Name + count labels laid separately from the SVG so long names aren't clipped
              to the circle's bounds — matches the mock's always-visible <div>name</div>/count
              treatment rather than gating text on radius or hiding it behind hover. */}
          <div style={{ position: "absolute", inset: 0, top: 0 }}>
            {band.rows.map((row, ri) => row.items.map((it, ii) => (
              <Tooltip key={ri + "-" + ii} content={`${it.label}\n${it.count} ${it.unit || ""}`.trim()}
                style={{ position: "absolute", left: it.cx - it.r, top: row.cy - it.r, width: it.r * 2, height: it.r * 2, pointerEvents: onSelect ? "auto" : "none" }}>
                <span
                  onClick={() => onSelect && onSelect(it.id)}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    width: "100%", height: "100%", textAlign: "center", padding: "0 2px",
                    cursor: onSelect ? "pointer" : "default", pointerEvents: "auto",
                    color: focusRole(it.id, focus) === "self" || it.filled ? "var(--text-inverse)" : "var(--text-hi)",
                    font: Math.min(10, it.r / 2.8) + "px var(--font-mono)", fontWeight: 600, lineHeight: 1.25,
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{it.label}</span>
                  <span style={{ opacity: 0.75 }}>{it.count}{it.unit ? ` ${it.unit}` : ""}</span>
                </span>
              </Tooltip>
            )))}
          </div>
        </div>
      ))}
    </div>
  );
}

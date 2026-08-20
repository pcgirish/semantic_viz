import type { SceneNode } from "@scv/layout";
import { el, ngon, ptstr } from "./svg.js";

const CORNER = 6; // chamfer radius, so tiles read as tiles rather than plain rectangles
const GLYPH_R = 7.5;
const LABEL_PAD = 12; // matches the label's x offset from the tile's left edge

/** Horizontal track the complexity glyph reserves in a tile's top-right corner: its
 *  diameter plus the 6px inset used when placing it, so labels stop short of it. */
export const GLYPH_TRACK = GLYPH_R * 2 + 6;

/** Advance widths in ems for Space Grotesk (--font-core), bucketed by glyph class. A flat
 *  per-character average over-truncates names made of narrow glyphs — the common case for
 *  identifiers and version strings — so measure the classes separately instead. */
const EM_WIDE = 0.78; // W M m — and uppercase generally runs wider than lowercase
const EM_NARROW = 0.3; // i l j t f r I . : · space
const EM_DEFAULT = 0.53;
const NARROW_CHARS = new Set("iljtfrI.,:;·'`|!()[]{} ".split(""));
const WIDE_CHARS = new Set("WMmw@%&".split(""));

/** Width of `text` in px at `fontSize`, estimated per glyph class rather than by a flat average. */
export function measureLabel(text: string, fontSize: number): number {
  let ems = 0;
  for (const ch of text) {
    if (NARROW_CHARS.has(ch)) ems += EM_NARROW;
    else if (WIDE_CHARS.has(ch)) ems += EM_WIDE;
    else if (ch >= "A" && ch <= "Z") ems += 0.66;
    else ems += EM_DEFAULT;
  }
  return ems * fontSize;
}

/** Truncates `name` with an ellipsis so it fits in `availWidth` px at `fontSize`, if needed. */
function fitLabel(name: string, availWidth: number, fontSize: number): string {
  if (measureLabel(name, fontSize) <= availWidth) return name;
  const budget = availWidth - measureLabel("…", fontSize);
  let width = 0;
  let cut = 0;
  for (const ch of name) {
    const next = width + measureLabel(ch, fontSize);
    if (next > budget) break;
    width = next;
    cut += ch.length;
  }
  return `${name.slice(0, Math.max(1, cut))}…`;
}

/**
 * Renders one Scene node as an SVG <g>: a chamfered tile sized to the node's box, a
 * complexity glyph (sides = bucket, per docs/serve.md#2 "sides = complexity, with a
 * correction"), and an offset risk ring when `ring` is set (docs/serve.md#2, "Offset ring").
 */
export function node(n: SceneNode): SVGGElement {
  const g = el("g", { class: "tile" });
  g.dataset.id = n.id;

  const isDiamond = n.blockType === "decision" || n.blockType === "loop";
  const pts: Array<[number, number]> = isDiamond
    ? [
        [n.x + n.w / 2, n.y],
        [n.x + n.w, n.y + n.h / 2],
        [n.x + n.w / 2, n.y + n.h],
        [n.x, n.y + n.h / 2],
      ]
    : (() => {
        const ch = Math.min(CORNER, n.h / 4, n.w / 4);
        return [
          [n.x + ch, n.y],
          [n.x + n.w, n.y],
          [n.x + n.w, n.y + n.h - ch],
          [n.x + n.w - ch, n.y + n.h],
          [n.x, n.y + n.h],
          [n.x, n.y + ch],
        ];
      })();
  g.appendChild(el("polygon", { points: ptstr(pts), class: isDiamond ? "block-diamond tile-body" : "tile-body" }));

  const nameSize = Math.min(14, Math.max(10.5, n.w / 10));
  const hasGlyph = !isDiamond && !n.blockType;
  // Left pad, then either the glyph's track (which already includes its right inset) or a
  // matching right pad — not both, or the label loses ~12px it could legitimately use.
  const labelTrack = n.w - LABEL_PAD - (hasGlyph ? GLYPH_TRACK : LABEL_PAD);
  const fittedName = fitLabel(n.name, labelTrack, nameSize);
  const label = isDiamond
    ? el("text", { x: n.x + n.w / 2, y: n.y + n.h / 2, "text-anchor": "middle", "dominant-baseline": "middle", class: "nm", "font-size": nameSize })
    : el("text", { x: n.x + LABEL_PAD, y: n.y + 22, class: "nm", "font-size": nameSize });
  label.textContent = fittedName;
  g.appendChild(label);
  if (fittedName !== n.name) {
    const title = el("title", {});
    title.textContent = n.name;
    g.appendChild(title);
  }

  if (!isDiamond && !n.blockType) {
    const metaSize = 9.5;
    const meta = el("text", { x: n.x + 12, y: n.y + 36, class: "mt", "font-size": metaSize });
    meta.textContent = fitLabel(`${n.sloc} sloc · in ${n.fanIn} · out ${n.fanOut}`, n.w - LABEL_PAD * 2, metaSize);
    g.appendChild(meta);
  }

  if (n.ring) {
    const ringPts = pts.map(([x, y]) => [x + 3, y + 3] as [number, number]);
    g.appendChild(el("polygon", { points: ptstr(ringPts), class: "ring", fill: "none" }));
  }

  if (!isDiamond && !n.blockType) {
    const gx = n.x + n.w - GLYPH_R - 6;
    const gy = n.y + GLYPH_R + 6;
    if (n.sides === 0) {
      g.appendChild(el("circle", { cx: gx, cy: gy, r: GLYPH_R, class: "complexity-glyph" }));
    } else {
      g.appendChild(el("polygon", { points: ptstr(ngon(gx, gy, GLYPH_R, n.sides)), class: "complexity-glyph" }));
    }

    if (n.complexity > 0) {
      const cx = el("text", { x: gx - GLYPH_R - 4, y: gy + 3.4, "text-anchor": "end", class: "cx" });
      cx.textContent = String(n.complexity);
      g.appendChild(cx);
    }
  }

  return g;
}

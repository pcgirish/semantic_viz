import { isDummy } from "./expand.js";

export type Box = { x: number; y: number; w: number; h: number };

const MIN_DIM = 96; // large enough to hold a name label + metadata line (docs/mock's drawTiles)
const MAX_DIM = 1200; // cap tile size so a lone/huge node never stretches full-canvas
const AREA_SCALE = 4; // px^2 per sloc unit before sqrt
const GAP = 16;
const ROW_GAP = 64; // wide enough for skip-level edges to bow around intervening rows' boxes instead of skimming through them
const DUMMY_DIM = 6; // small fixed-width pass-through marker for an expanded edge's midpoint
const MAX_ROW_TILES = 6; // wrap threshold for a flat (single-rank) row — a grid reads better than one long strip

/**
 * Nested-box placement: one row per rank, boxes sized by sqrt(sloc) (area, not length,
 * carries sloc — see docs/serve.md#2), laid out left-to-right and centred, rows stacked
 * vertically. Width/height are capped (implement-serve.md fix #1) so a lone big node in a
 * row leaves room for skip-level edges to route through instead of eating the whole canvas.
 * Dummy nodes (from expand.ts) get a small fixed size instead of a sloc-based one — they
 * carry no code, just a routing waypoint for a skip-level edge.
 */
export function place(rows: string[][], sloc: Map<string, number>): Map<string, Box> {
  const boxes = new Map<string, Box>();

  function dimFor(id: string): number {
    if (isDummy(id)) return DUMMY_DIM;
    const area = Math.max(1, sloc.get(id) ?? 1) * AREA_SCALE;
    const side = Math.sqrt(area);
    return Math.min(MAX_DIM, Math.max(MIN_DIM, side));
  }

  // A single rank (no cross-rank structure to justify one full-width row, e.g. a repo
  // with zero cross-layer edges) gets wrapped into multiple rows instead. Rows produced
  // by order.ts's crossing-minimization (rows.length > 1) are left alone.
  const effectiveRows = rows.length === 1 ? wrapRow(rows[0]!) : rows;

  let y = 0;
  for (const row of effectiveRows) {
    const dims = row.map((id) => ({ id, size: dimFor(id) }));
    const rowWidth = dims.reduce((acc, d) => acc + d.size, 0) + GAP * Math.max(0, dims.length - 1);
    const rowHeight = dims.length > 0 ? Math.max(...dims.map((d) => d.size)) : 0;

    let x = -rowWidth / 2;
    for (const { id, size } of dims) {
      boxes.set(id, { x, y, w: size, h: size });
      x += size + GAP;
    }
    y += rowHeight + ROW_GAP;
  }

  return boxes;
}

function wrapRow(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += MAX_ROW_TILES) {
    out.push(ids.slice(i, i + MAX_ROW_TILES));
  }
  return out.length > 0 ? out : [ids];
}

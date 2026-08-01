export type OrderEdge = { from: string; to: string };

/**
 * Groups ids into rows by rank, then reduces crossings with barycentre sweeps: each row's
 * ids are reordered by the mean x-position (current index) of their neighbours in the row
 * above, then below, alternating a few passes. Ties (equal or undefined barycentre) keep
 * `unitIds` input order — the deterministic tiebreak docs/serve.md calls "file order".
 */
export function order(unitIds: string[], ranks: Map<string, number>, edges: OrderEdge[]): string[][] {
  const maxRank = Math.max(0, ...[...ranks.values()]);
  const rows: string[][] = Array.from({ length: maxRank + 1 }, () => []);
  const inputIndex = new Map(unitIds.map((id, i) => [id, i]));

  for (const id of unitIds) {
    const r = ranks.get(id) ?? 0;
    rows[r]!.push(id);
  }
  for (const row of rows) {
    row.sort((a, b) => inputIndex.get(a)! - inputIndex.get(b)!);
  }

  const neighboursAbove = new Map<string, string[]>();
  const neighboursBelow = new Map<string, string[]>();
  for (const id of unitIds) {
    neighboursAbove.set(id, []);
    neighboursBelow.set(id, []);
  }
  for (const e of edges) {
    if (!neighboursAbove.has(e.from) || !neighboursAbove.has(e.to)) continue;
    const rFrom = ranks.get(e.from) ?? 0;
    const rTo = ranks.get(e.to) ?? 0;
    if (rTo === rFrom + 1) {
      neighboursAbove.get(e.to)!.push(e.from);
      neighboursBelow.get(e.from)!.push(e.to);
    } else if (rFrom === rTo + 1) {
      neighboursAbove.get(e.from)!.push(e.to);
      neighboursBelow.get(e.to)!.push(e.from);
    }
  }

  function sweep(neighbours: Map<string, string[]>, rowStart: number, rowEnd: number, step: number): void {
    for (let r = rowStart; r !== rowEnd; r += step) {
      const positions = new Map(rows[r - step]!.map((id, i) => [id, i]));
      const barycentre = new Map<string, number | undefined>();
      for (const id of rows[r]!) {
        const ns = neighbours.get(id)!;
        if (ns.length === 0) {
          barycentre.set(id, undefined);
          continue;
        }
        const sum = ns.reduce((acc, n) => acc + (positions.get(n) ?? 0), 0);
        barycentre.set(id, sum / ns.length);
      }
      rows[r]!.sort((a, b) => {
        const ba = barycentre.get(a);
        const bb = barycentre.get(b);
        if (ba === undefined && bb === undefined) return inputIndex.get(a)! - inputIndex.get(b)!;
        if (ba === undefined) return -1;
        if (bb === undefined) return 1;
        if (ba !== bb) return ba - bb;
        return inputIndex.get(a)! - inputIndex.get(b)!;
      });
    }
  }

  const PASSES = 4;
  for (let pass = 0; pass < PASSES; pass++) {
    sweep(neighboursAbove, 1, rows.length, 1);
    sweep(neighboursBelow, rows.length - 2, -1, -1);
  }

  return rows;
}

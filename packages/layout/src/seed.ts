/**
 * Reorders each row so ids with a prior x position keep their prior relative left-right
 * order, instead of whatever `order`'s barycentre sweep produced this pass. Stability is a
 * hard requirement (docs/serve.md#3): replay is unreadable if nodes teleport between revs.
 * New ids (no prior position) are stable-sorted in by their position in the input row,
 * relative to the nearest surrounding seeded ids, so they don't disturb existing order.
 */
export function seed(rows: string[][], priorX: Map<string, number>): string[][] {
  if (priorX.size === 0) return rows.map((row) => [...row]);

  return rows.map((row) => {
    const inputIndex = new Map(row.map((id, i) => [id, i]));
    return [...row].sort((a, b) => {
      const xa = priorX.get(a);
      const xb = priorX.get(b);
      if (xa !== undefined && xb !== undefined) return xa - xb || inputIndex.get(a)! - inputIndex.get(b)!;
      if (xa !== undefined) return -1 * compareNewAgainstSeeded(inputIndex, a, b);
      if (xb !== undefined) return compareNewAgainstSeeded(inputIndex, b, a);
      return inputIndex.get(a)! - inputIndex.get(b)!;
    });
  });
}

/** a is seeded, b is new: keep b on whichever side of a it started on in the input row. */
function compareNewAgainstSeeded(inputIndex: Map<string, number>, seededId: string, newId: string): -1 | 1 {
  return inputIndex.get(newId)! < inputIndex.get(seededId)! ? 1 : -1;
}

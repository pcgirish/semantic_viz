import type { Unit, UnitRelationship } from "@scv/schema";

/**
 * Group lineage across two snapshots.
 *
 * Reclustering rarely edits a group in place — it breaks one apart or fuses several together, and
 * `added`/`removed` alone renders that as churn with no thread connecting the two sides. The
 * statuses stay as they are; this computes the `relationship` that explains them, from member
 * overlap, which is the only place membership lineage is actually known.
 */

/** Below this Jaccard index, shared members are coincidence rather than lineage. */
export const OVERLAP_THRESHOLD = 0.2;

/** A successor must be at least this majority-composed of its predecessor to count as one. */
export const MERGE_MAJORITY = 0.5;

interface Candidate {
  from: string;
  to: string;
  jaccard: number;
  shared: number;
  /** Share of `to`'s members that came from `from`. */
  ofTo: number;
  /** Share of `from`'s members that went to `to`. */
  ofFrom: number;
}

/**
 * Returns the relationship for every group on either side that participates in a split or a merge.
 * Groups with unchanged membership, 1:1 drift, or no above-threshold counterpart are absent —
 * `modified`/`added`/`removed` already describe those without help.
 */
export function matchGroupLineage(before: Unit[], after: Unit[]): Map<string, UnitRelationship> {
  const oldGroups = membership(before);
  const newGroups = membership(after);

  // Identity first: equal membership is the same group, and it is out of the running for
  // everything below — a group that did not move has no lineage to explain.
  for (const [id, members] of [...oldGroups]) {
    const other = newGroups.get(id);
    if (other && sameMembers(members, other)) {
      oldGroups.delete(id);
      newGroups.delete(id);
    }
  }

  const candidates: Candidate[] = [];
  for (const [from, a] of oldGroups) {
    for (const [to, b] of newGroups) {
      const shared = [...a].filter((m) => b.has(m)).length;
      if (shared === 0) continue;
      const jaccard = shared / new Set([...a, ...b]).size;
      if (jaccard < OVERLAP_THRESHOLD) continue;
      candidates.push({ from, to, jaccard, shared, ofTo: shared / b.size, ofFrom: shared / a.size });
    }
  }

  // Both pools are computed over the whole snapshot before anything is emitted, so precedence is
  // decided with full knowledge rather than by whichever group happened to be visited first.
  const splits = new Map<string, string[]>();
  for (const [from, members] of oldGroups) {
    const successors = candidates.filter((c) => c.from === from && c.ofTo >= MERGE_MAJORITY);
    if (successors.length < 2) continue;
    const covered = new Set(successors.flatMap((c) => [...members].filter((m) => newGroups.get(c.to)!.has(m))));
    if (covered.size / members.size < MERGE_MAJORITY) continue;
    splits.set(from, successors.map((c) => c.to));
  }

  const merges = new Map<string, string[]>();
  for (const [to] of newGroups) {
    const predecessors = candidates.filter((c) => c.to === to && c.ofFrom >= MERGE_MAJORITY);
    if (predecessors.length < 2) continue;
    const target = newGroups.get(to)!;
    const covered = new Set(predecessors.flatMap((c) => [...oldGroups.get(c.from)!].filter((m) => target.has(m))));
    if (covered.size / target.size < MERGE_MAJORITY) continue;
    merges.set(to, predecessors.map((c) => c.from));
  }

  const relationships = new Map<string, UnitRelationship>();
  const consumed = new Set<string>();

  // Split wins over merge: a group that lost members describes its own history better than one
  // that gained them, and its counterpart list is the more informative of the two.
  for (const from of [...splits.keys()].sort()) {
    const successors = splits.get(from)!.filter((id) => !consumed.has(id));
    if (consumed.has(from) || successors.length < 2) continue;
    consumed.add(from);
    relationships.set(from, { kind: "split", counterparts: [...successors].sort() });
    for (const to of successors) {
      consumed.add(to);
      relationships.set(to, { kind: "split", counterparts: [from] });
    }
  }

  for (const to of [...merges.keys()].sort()) {
    const predecessors = merges.get(to)!.filter((id) => !consumed.has(id));
    if (consumed.has(to) || predecessors.length < 2) continue;
    consumed.add(to);
    relationships.set(to, { kind: "merged", counterparts: [...predecessors].sort() });
    for (const from of predecessors) {
      consumed.add(from);
      relationships.set(from, { kind: "merged", counterparts: [to] });
    }
  }

  return relationships;
}

function membership(units: Unit[]): Map<string, Set<string>> {
  return new Map(units.filter((u) => u.kind === "group").map((u) => [u.id, new Set(u.children)]));
}

function sameMembers(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((m) => b.has(m));
}

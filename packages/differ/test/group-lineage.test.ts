import { describe, expect, it } from "vitest";
import type { Unit } from "@scv/schema";
import { matchGroupLineage, MERGE_MAJORITY, OVERLAP_THRESHOLD } from "../src/group-lineage.js";

function group(id: string, members: string[]): Unit {
  return {
    id,
    kind: "group",
    name: id,
    qualname: id,
    parent: "u:sys:r",
    children: [...members].sort(),
    loc: { files: [], start: null, end: null, sloc: 0 },
    semantics: null,
    cost: null,
    tags: [],
    metrics: { layers: members.length },
    hash: { struct: [...members].sort().join(","), text: null, semantic: id },
    provenance: { source: "llm", pass: "C" },
  } as Unit;
}

describe("matchGroupLineage", () => {
  it("reports nothing when membership is identical", () => {
    const before = [group("g1", ["a", "b"])];
    const after = [group("g1", ["b", "a"])];
    expect(matchGroupLineage(before, after)).toEqual(new Map());
  });

  it("classifies one group breaking into two as a split on all three units", () => {
    const before = [group("old", ["a", "b", "c", "d"])];
    const after = [group("n1", ["a", "b"]), group("n2", ["c", "d"])];

    const rel = matchGroupLineage(before, after);
    expect(rel.get("old")).toEqual({ kind: "split", counterparts: ["n1", "n2"] });
    expect(rel.get("n1")).toEqual({ kind: "split", counterparts: ["old"] });
    expect(rel.get("n2")).toEqual({ kind: "split", counterparts: ["old"] });
  });

  it("classifies two groups collapsing into one as a merge", () => {
    const before = [group("o1", ["a", "b"]), group("o2", ["c", "d"])];
    const after = [group("new", ["a", "b", "c", "d"])];

    const rel = matchGroupLineage(before, after);
    expect(rel.get("new")).toEqual({ kind: "merged", counterparts: ["o1", "o2"] });
    expect(rel.get("o1")).toEqual({ kind: "merged", counterparts: ["new"] });
    expect(rel.get("o2")).toEqual({ kind: "merged", counterparts: ["new"] });
  });

  it("treats a 1:1 pairing with churn as drift, not a lineage event", () => {
    // One member swapped out: the same group with churn, which `modified` already describes.
    const before = [group("g1", ["a", "b", "c"])];
    const after = [group("g2", ["a", "b", "d"])];
    expect(matchGroupLineage(before, after)).toEqual(new Map());
  });

  it("ignores pairs below the overlap threshold, where lineage is coincidence", () => {
    // 1 shared member out of 9 union = 0.11, under 0.2.
    const before = [group("g1", ["a", "b", "c", "d", "e"])];
    const after = [group("g2", ["a", "f", "g", "h", "i"])];
    expect(matchGroupLineage(before, after)).toEqual(new Map());
    expect(OVERLAP_THRESHOLD).toBe(0.2);
    expect(MERGE_MAJORITY).toBe(0.5);
  });

  it("prefers split over merge when a group qualifies for both", () => {
    // `old` breaks apart into n1/n2, while n2 simultaneously absorbs all of `other`.
    // Split describes `old`'s history better, and consuming it leaves no group with two
    // relationships.
    const before = [group("old", ["a", "b", "c", "d"]), group("other", ["e", "f"])];
    const after = [group("n1", ["a", "b"]), group("n2", ["c", "d", "e", "f"])];

    const rel = matchGroupLineage(before, after);
    expect(rel.get("old")?.kind).toBe("split");
    for (const [, value] of rel) expect(value.counterparts).toEqual([...value.counterparts].sort());
  });

  it("sorts counterparts by id, never by score, so runs are diffable", () => {
    const before = [group("old", ["a", "b", "c", "d", "e", "f"])];
    const after = [group("zz", ["a", "b", "c"]), group("aa", ["d", "e", "f"])];
    expect(matchGroupLineage(before, after).get("old")?.counterparts).toEqual(["aa", "zz"]);
  });

  it("gives no group two relationships", () => {
    const before = [group("o1", ["a", "b", "c", "d"]), group("o2", ["e", "f"])];
    const after = [group("n1", ["a", "b"]), group("n2", ["c", "d", "e", "f"])];

    const rel = matchGroupLineage(before, after);
    const seen = new Set<string>();
    for (const id of rel.keys()) {
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });

  it("looks only at groups, ignoring layers and modules that share the snapshot", () => {
    const layer = { ...group("lay", ["a"]), kind: "layer" } as Unit;
    expect(matchGroupLineage([layer], [layer])).toEqual(new Map());
  });
});

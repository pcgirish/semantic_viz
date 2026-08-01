import { describe, expect, it } from "vitest";
import { expand, isDummy } from "../src/expand.js";

describe("expand", () => {
  it("leaves adjacent-rank edges (span 1) untouched, no dummies", () => {
    const ranks = new Map([["a", 0], ["b", 1]]);
    const { unitIds, edges, chains } = expand(["a", "b"], ranks, [{ from: "a", to: "b" }]);
    expect(unitIds).toEqual(["a", "b"]);
    expect(edges).toEqual([{ from: "a", to: "b" }]);
    expect(chains).toEqual([{ from: "a", to: "b", nodes: ["a", "b"] }]);
  });

  it("inserts one dummy per intermediate rank for a skip-level edge", () => {
    // a (rank 0) -> d (rank 3): spans ranks 1 and 2, needs two dummies
    const ranks = new Map([["a", 0], ["b", 1], ["c", 2], ["d", 3]]);
    const { unitIds, edges, chains, dummyRank } = expand(
      ["a", "b", "c", "d"],
      ranks,
      [{ from: "a", to: "d" }],
    );
    const dummies = unitIds.filter((id) => isDummy(id));
    expect(dummies).toHaveLength(2);
    // chain edges are adjacent-rank only, each hop present
    const chain = chains.find((c) => c.from === "a" && c.to === "d")!;
    expect(chain.nodes).toHaveLength(4); // a, dummy@1, dummy@2, d
    expect(chain.nodes[0]).toBe("a");
    expect(chain.nodes[3]).toBe("d");
    for (const dummyId of dummies) {
      expect(dummyRank.get(dummyId)).toBeGreaterThanOrEqual(1);
      expect(dummyRank.get(dummyId)).toBeLessThanOrEqual(2);
    }
    // edges list only has adjacent-rank hops
    for (const e of edges) {
      const rFrom = ranks.get(e.from) ?? dummyRank.get(e.from);
      const rTo = ranks.get(e.to) ?? dummyRank.get(e.to);
      expect(Math.abs(rTo! - rFrom!)).toBe(1);
    }
  });

  it("drops back-edges (target rank <= source rank) from expansion, keeps them as a marked chain", () => {
    const ranks = new Map([["a", 0], ["b", 1]]);
    const { chains, edges } = expand(["a", "b"], ranks, [{ from: "b", to: "a" }]);
    const chain = chains.find((c) => c.from === "b" && c.to === "a")!;
    expect(chain.back).toBe(true);
    expect(chain.nodes).toEqual(["b", "a"]);
    // back-edges never enter the adjacent-rank edge list used for ordering
    expect(edges).toHaveLength(0);
  });

  it("is a no-op on a graph with no edges", () => {
    const ranks = new Map([["a", 0]]);
    const { unitIds, edges, chains } = expand(["a"], ranks, []);
    expect(unitIds).toEqual(["a"]);
    expect(edges).toEqual([]);
    expect(chains).toEqual([]);
  });
});

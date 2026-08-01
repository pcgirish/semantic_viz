import { describe, expect, it } from "vitest";
import { order } from "../src/order.js";

describe("order", () => {
  it("orders a single rank by input order when there are no edges", () => {
    const ranks = new Map([["a", 0], ["b", 0], ["c", 0]]);
    const rows = order(["a", "b", "c"], ranks, []);
    expect(rows).toEqual([["a", "b", "c"]]);
  });

  it("groups ids into rows by rank", () => {
    const ranks = new Map([["a", 0], ["b", 1], ["c", 1]]);
    const rows = order(["a", "b", "c"], ranks, [
      { from: "a", to: "b" },
      { from: "a", to: "c" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(["a"]);
    expect(new Set(rows[1])).toEqual(new Set(["b", "c"]));
  });

  it("reduces crossings by ordering rank 1 to match the barycentre of rank 0", () => {
    // a0 -> b1, a0 -> c1 wired so that starting order [c, b] should flip to [b, c]
    // once b's single parent (a, at x-position 0) pulls it toward the left, matching
    // a's own connections order.
    const ranks = new Map([["p1", 0], ["p2", 0], ["b", 1], ["c", 1]]);
    const rows = order(["p1", "p2", "c", "b"], ranks, [
      { from: "p1", to: "b" },
      { from: "p2", to: "c" },
    ]);
    // p1 is left of p2 (input order preserved, no incoming edges to reorder rank 0),
    // so b (child of p1) should end up left of c (child of p2).
    expect(rows[1]).toEqual(["b", "c"]);
  });

  it("is deterministic: equal barycentres keep input order", () => {
    const ranks = new Map([["x", 0], ["a", 1], ["b", 1]]);
    const rows = order(["x", "a", "b"], ranks, [
      { from: "x", to: "a" },
      { from: "x", to: "b" },
    ]);
    expect(rows[1]).toEqual(["a", "b"]);
  });
});

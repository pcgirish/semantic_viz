import { describe, expect, it } from "vitest";
import { seed } from "../src/seed.js";

describe("seed", () => {
  it("keeps row order unchanged when there is no prior layout", () => {
    const rows = seed([["a", "b", "c"]], new Map());
    expect(rows).toEqual([["a", "b", "c"]]);
  });

  it("reorders a row to match the prior layout's relative left-right order", () => {
    // barycentre gave [c, a, b] but the prior snapshot had a left of b left of c
    const priorX = new Map([["a", 0], ["b", 100], ["c", 200]]);
    const rows = seed([["c", "a", "b"]], priorX);
    expect(rows).toEqual([["a", "b", "c"]]);
  });

  it("inserts a brand-new node (no prior position) without reordering existing nodes", () => {
    const priorX = new Map([["a", 0], ["b", 100]]);
    // "new" has no prior position; existing a, b must stay in their prior relative order
    const rows = seed([["b", "new", "a"]], priorX);
    const withoutNew = rows[0]!.filter((id) => id !== "new");
    expect(withoutNew).toEqual(["a", "b"]);
    expect(rows[0]).toContain("new");
  });

  it("preserves multi-row structure", () => {
    const priorX = new Map([["a", 0], ["b", 0], ["c", 100]]);
    const rows = seed([["a"], ["c", "b"]], priorX);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(["a"]);
  });
});

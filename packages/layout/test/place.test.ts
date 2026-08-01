import { describe, expect, it } from "vitest";
import { place } from "../src/place.js";
import { isDummy } from "../src/expand.js";

describe("place", () => {
  it("places a single node at the row origin", () => {
    const boxes = place([["a"]], new Map([["a", 100]]));
    const a = boxes.get("a")!;
    expect(a.y).toBe(0);
    expect(a.w).toBeGreaterThan(0);
    expect(a.h).toBeGreaterThan(0);
  });

  it("sizes width by sqrt(sloc), not linearly", () => {
    const boxes = place([["small", "big"]], new Map([["small", 400], ["big", 6400]]));
    const small = boxes.get("small")!;
    const big = boxes.get("big")!;
    // sqrt(6400)/sqrt(400) = 4, not 6400/400 = 16
    expect(big.w / small.w).toBeCloseTo(4, 1);
  });

  it("stacks rows vertically without overlap", () => {
    const boxes = place([["a"], ["b"]], new Map([["a", 100], ["b", 100]]));
    const a = boxes.get("a")!;
    const b = boxes.get("b")!;
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.h);
  });

  it("does not overlap siblings within a row", () => {
    const boxes = place([["a", "b", "c"]], new Map([["a", 100], ["b", 100], ["c", 100]]));
    const a = boxes.get("a")!;
    const b = boxes.get("b")!;
    const c = boxes.get("c")!;
    expect(b.x).toBeGreaterThanOrEqual(a.x + a.w);
    expect(c.x).toBeGreaterThanOrEqual(b.x + b.w);
  });

  it("caps a lone node's width instead of stretching it full-canvas", () => {
    const lonely = place([["solo"]], new Map([["solo", 100000]]));
    const crowded = place(
      [["p", "q", "r", "solo2"]],
      new Map([["p", 100], ["q", 100], ["r", 100], ["solo2", 100000]]),
    );
    expect(lonely.get("solo")!.w).toBeLessThan(2000);
    expect(crowded.get("solo2")!.w).toBeLessThan(2000);
  });

  it("sizes a dummy node as a small fixed-width pass-through marker, not by sloc", () => {
    const dummyId = "~dummy~a|d|1";
    expect(isDummy(dummyId)).toBe(true);
    const boxes = place([["real", dummyId]], new Map([["real", 400]]));
    const dummy = boxes.get(dummyId)!;
    expect(dummy.w).toBeLessThan(boxes.get("real")!.w);
    expect(dummy.w).toBeLessThanOrEqual(8);
  });
});

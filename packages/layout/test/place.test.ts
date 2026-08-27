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
    // sloc chosen so both boxes clear MIN_DIM (96px floor) and the ratio isn't clamped away
    const boxes = place([["small", "big"]], new Map([["small", 4000], ["big", 64000]]));
    const small = boxes.get("small")!;
    const big = boxes.get("big")!;
    // sqrt(64000)/sqrt(4000) = 4, not 64000/4000 = 16
    expect(big.w / small.w).toBeCloseTo(4, 1);
  });

  it("stacks rows vertically without overlap, last rank on top", () => {
    // Rows arrive in rank order; the highest rank (most foundational) renders at the top.
    const boxes = place([["a"], ["b"]], new Map([["a", 100], ["b", 100]]));
    const a = boxes.get("a")!;
    const b = boxes.get("b")!;
    expect(a.y).toBeGreaterThanOrEqual(b.y + b.h);
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

  it("keeps a minimum tile size large enough for a skin to render a name label", () => {
    const boxes = place([["tiny"]], new Map([["tiny", 1]]));
    expect(boxes.get("tiny")!.w).toBeGreaterThanOrEqual(90);
    expect(boxes.get("tiny")!.h).toBeGreaterThanOrEqual(90);
  });

  it("sizes a dummy node as a small fixed-width pass-through marker, not by sloc", () => {
    const dummyId = "~dummy~a|d|1";
    expect(isDummy(dummyId)).toBe(true);
    const boxes = place([["real", dummyId]], new Map([["real", 400]]));
    const dummy = boxes.get(dummyId)!;
    expect(dummy.w).toBeLessThan(boxes.get("real")!.w);
    expect(dummy.w).toBeLessThanOrEqual(8);
  });

  describe("wrapping a flat single rank into multiple rows", () => {
    function manyIds(n: number): string[] {
      return Array.from({ length: n }, (_, i) => `n${i}`);
    }
    function sizedSloc(ids: string[]): Map<string, number> {
      return new Map(ids.map((id) => [id, 2_000_000]));
    }

    it("wraps a single flat row that exceeds the max tile count into multiple rows", () => {
      const ids = manyIds(7);
      const boxes = place([ids], sizedSloc(ids));
      const ys = new Set(ids.map((id) => boxes.get(id)!.y));
      expect(ys.size).toBeGreaterThan(1);
    });

    it("leaves a single row that already fits within the max tile count unwrapped", () => {
      const ids = ["a", "b", "c"];
      const boxes = place([ids], new Map(ids.map((id) => [id, 100])));
      const ys = new Set(ids.map((id) => boxes.get(id)!.y));
      expect(ys.size).toBe(1);
    });

    it("wraps a single flat row of many small (MIN_DIM) tiles by count, even though they'd all fit width-wise", () => {
      // Reproduces the extractor-core case: 11 modules, 0 edges among them, each tile
      // clamped to MIN_DIM (96px) — small enough that all 11 fit under any reasonable
      // pixel-width threshold, but still reads as one long flat strip.
      const ids = manyIds(11);
      const boxes = place([ids], new Map(ids.map((id) => [id, 1])));
      const ys = new Set(ids.map((id) => boxes.get(id)!.y));
      expect(ys.size).toBeGreaterThan(1);
    });

    it("never wraps when there is real multi-rank structure, even if one row is individually wide", () => {
      const wideRow = manyIds(6);
      const boxes = place([wideRow, ["leaf"]], sizedSloc(wideRow));
      const ys = new Set(wideRow.map((id) => boxes.get(id)!.y));
      expect(ys.size).toBe(1);
    });

    it("does not overlap tiles across wrapped sub-rows", () => {
      const ids = manyIds(6);
      const boxes = place([ids], sizedSloc(ids));
      const rows = new Map<number, string[]>();
      for (const id of ids) {
        const y = boxes.get(id)!.y;
        rows.set(y, [...(rows.get(y) ?? []), id]);
      }
      const sortedYs = [...rows.keys()].sort((a, b) => a - b);
      for (let i = 1; i < sortedYs.length; i++) {
        const prevRowIds = rows.get(sortedYs[i - 1]!)!;
        const prevMaxH = Math.max(...prevRowIds.map((id) => boxes.get(id)!.h));
        expect(sortedYs[i]).toBeGreaterThanOrEqual(sortedYs[i - 1]! + prevMaxH);
      }
    });
  });
});

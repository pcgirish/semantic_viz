import { describe, expect, it } from "vitest";
import type { Edge, Unit } from "@scv/schema";
import { nestedScene } from "../src/nested.js";

function makeUnit(overrides: Partial<Unit> & { id: string }): Unit {
  return {
    kind: "module",
    name: overrides.id,
    qualname: overrides.id,
    parent: null,
    children: [],
    loc: { files: [], sloc: 10 },
    tags: [],
    metrics: {},
    hash: { struct: null, text: null, semantic: null },
    provenance: { source: "static" },
    ...overrides,
  };
}

describe("nestedScene", () => {
  it("returns null when the parent box is below the legibility floor", () => {
    const children = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    const result = nestedScene(children, [], { x: 0, y: 0, w: 6, h: 6 });
    expect(result).toBeNull();
  });

  it("returns null when there are no children", () => {
    const result = nestedScene([], [], { x: 0, y: 0, w: 200, h: 200 });
    expect(result).toBeNull();
  });

  it("lays out children scaled to fit entirely within the parent box", () => {
    const children = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    const edges: Edge[] = [{ id: "e1", from: "a", to: "b", kind: "calls", weight: 1, source: "static", confidence: 1 }];
    const parentBox = { x: 100, y: 100, w: 120, h: 80 };

    const result = nestedScene(children, edges, parentBox);

    expect(result).not.toBeNull();
    for (const n of result!.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(parentBox.x);
      expect(n.x + n.w).toBeLessThanOrEqual(parentBox.x + parentBox.w + 0.01);
      expect(n.y).toBeGreaterThanOrEqual(parentBox.y);
      expect(n.y + n.h).toBeLessThanOrEqual(parentBox.y + parentBox.h + 0.01);
    }
  });

  it("is a faithful thumbnail: preserves rank order (a above b, c) and sibling order (b left of c)", () => {
    const children = [makeUnit({ id: "a" }), makeUnit({ id: "b" }), makeUnit({ id: "c" })];
    const edges: Edge[] = [
      { id: "e1", from: "a", to: "b", kind: "calls", weight: 1, source: "static", confidence: 1 },
      { id: "e2", from: "a", to: "c", kind: "calls", weight: 1, source: "static", confidence: 1 },
    ];
    const result = nestedScene(children, edges, { x: 0, y: 0, w: 560, h: 340 });
    const byId = new Map(result!.nodes.map((n) => [n.id, n]));
    expect(byId.get("a")!.y).toBeLessThan(byId.get("b")!.y);
    expect(byId.get("b")!.x).toBeLessThan(byId.get("c")!.x);
  });
});

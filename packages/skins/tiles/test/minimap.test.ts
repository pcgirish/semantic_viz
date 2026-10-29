import { describe, expect, it } from "vitest";
import { minimap } from "../src/minimap.js";
import type { Edge, Unit } from "@semviz/schema";

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

describe("minimap", () => {
  it("renders a rect per child, all inside the parent box, when there is room", () => {
    const children = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    const el = minimap(children, [] as Edge[], { x: 0, y: 0, w: 560, h: 340 });
    expect(el).not.toBeNull();
    const rects = el!.querySelectorAll("rect");
    expect(rects.length).toBe(2);
  });

  it("returns null (caller falls back to a count) when the box is below the legibility floor", () => {
    const children = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    const el = minimap(children, [] as Edge[], { x: 0, y: 0, w: 6, h: 6 });
    expect(el).toBeNull();
  });

  it("returns null when there are no children", () => {
    const el = minimap([], [] as Edge[], { x: 0, y: 0, w: 200, h: 200 });
    expect(el).toBeNull();
  });
});

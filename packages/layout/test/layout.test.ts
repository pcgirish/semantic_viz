import { describe, expect, it } from "vitest";
import { buildScene } from "../src/layout.js";
import type { Edge, Unit } from "@scv/schema";

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

function makeEdge(overrides: Partial<Edge> & { id: string; from: string; to: string }): Edge {
  return { kind: "calls", weight: 1, source: "static", confidence: 1, ...overrides };
}

describe("buildScene", () => {
  it("produces a scene node per unit and a scene link per (bundled) edge", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    const edges = [makeEdge({ id: "e1", from: "a", to: "b" })];

    const scene = buildScene(units, edges);

    expect(scene.nodes).toHaveLength(2);
    expect(scene.links).toHaveLength(1);
    expect(scene.links[0]!.from).toBe("a");
    expect(scene.links[0]!.to).toBe("b");
  });

  it("ranks callers above callees (lower y = higher rank)", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    const edges = [makeEdge({ id: "e1", from: "a", to: "b" })];

    const scene = buildScene(units, edges);
    const a = scene.nodes.find((n) => n.id === "a")!;
    const b = scene.nodes.find((n) => n.id === "b")!;
    expect(a.y).toBeLessThan(b.y);
  });

  it("buckets sides by cyclomatic complexity", () => {
    const units = [
      makeUnit({ id: "trivial", cost: { complexity: 1 } }),
      makeUnit({ id: "ordinary", cost: { complexity: 4 } }),
      makeUnit({ id: "involved", cost: { complexity: 8 } }),
      makeUnit({ id: "alarming", cost: { complexity: 20 } }),
      makeUnit({ id: "unknown" }),
    ];
    const scene = buildScene(units, []);
    const sidesFor = (id: string) => scene.nodes.find((n) => n.id === id)!.sides;
    expect(sidesFor("trivial")).toBe(3);
    expect(sidesFor("ordinary")).toBe(4);
    expect(sidesFor("involved")).toBe(6);
    expect(sidesFor("alarming")).toBe(0);
    expect(sidesFor("unknown")).toBe(3);
  });

  it("seeds positions from a prior scene so nodes do not teleport", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" }), makeUnit({ id: "c" })];
    const first = buildScene(units, []);
    const shuffledUnits = [makeUnit({ id: "c" }), makeUnit({ id: "b" }), makeUnit({ id: "a" })];

    const second = buildScene(shuffledUnits, [], { priorScene: first });

    const orderOf = (scene: typeof first) =>
      [...scene.nodes].sort((x, y) => x.x - y.x).map((n) => n.id);
    expect(orderOf(second)).toEqual(orderOf(first));
  });

  it("carries name and fan-in/fan-out onto each scene node so a skin can render a label", () => {
    const units = [
      makeUnit({ id: "a", name: "alpha", loc: { files: [], sloc: 42 } }),
      makeUnit({ id: "b", name: "beta" }),
      makeUnit({ id: "c", name: "gamma" }),
    ];
    const edges = [makeEdge({ id: "e1", from: "a", to: "b" }), makeEdge({ id: "e2", from: "c", to: "a" })];

    const scene = buildScene(units, edges);
    const a = scene.nodes.find((n) => n.id === "a")!;
    expect(a.name).toBe("alpha");
    expect(a.sloc).toBe(42);
    expect(a.fanOut).toBe(1);
    expect(a.fanIn).toBe(1);
  });

  it("is a pure function: same input yields the same output", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" }), makeUnit({ id: "c" })];
    const edges = [makeEdge({ id: "e1", from: "a", to: "b" }), makeEdge({ id: "e2", from: "a", to: "c" })];

    const s1 = buildScene(units, edges);
    const s2 = buildScene(units, edges);
    expect(s1).toEqual(s2);
  });

  it("carries the nearest layer ancestor's id onto a scene node", () => {
    const units = [
      makeUnit({ id: "u:layer:abc123", kind: "layer", name: "orders" }),
      makeUnit({ id: "a", parent: "u:layer:abc123" }),
    ];
    const scene = buildScene(units, []);
    const a = scene.nodes.find((n) => n.id === "a")!;
    expect(a.layer).toBe("u:layer:abc123");
  });

  it("walks past non-layer parents to find the nearest layer ancestor", () => {
    const units = [
      makeUnit({ id: "u:layer:abc123", kind: "layer", name: "orders" }),
      makeUnit({ id: "cls", kind: "class", parent: "u:layer:abc123" }),
      makeUnit({ id: "a", parent: "cls" }),
    ];
    const scene = buildScene(units, []);
    const a = scene.nodes.find((n) => n.id === "a")!;
    expect(a.layer).toBe("u:layer:abc123");
  });

  it("gives a unit with no layer ancestor an empty layer id", () => {
    const units = [makeUnit({ id: "a" })];
    const scene = buildScene(units, []);
    expect(scene.nodes[0]!.layer).toBe("");
  });

  it("carries raw complexity onto a scene node, defaulting to 0 when cost is absent", () => {
    const units = [
      makeUnit({ id: "a", cost: { complexity: 7 } }),
      makeUnit({ id: "b" }),
    ];
    const scene = buildScene(units, []);
    expect(scene.nodes.find((n) => n.id === "a")!.complexity).toBe(7);
    expect(scene.nodes.find((n) => n.id === "b")!.complexity).toBe(0);
  });

  it("shows only the filename for a module unit, not its full relative path — the breadcrumb already gives the folder context", () => {
    const units = [makeUnit({ id: "m", kind: "module", name: "packages/extractor/src/facts.ts" })];
    const scene = buildScene(units, []);
    expect(scene.nodes[0]!.name).toBe("facts.ts");
  });

  it("leaves non-module unit names (already leaf symbol names) untouched", () => {
    const units = [makeUnit({ id: "f", kind: "function", name: "interpret" })];
    const scene = buildScene(units, []);
    expect(scene.nodes[0]!.name).toBe("interpret");
  });

  it("carries the nearest layer ancestor's group onto a scene node", () => {
    const units = [
      makeUnit({ id: "u:layer:abc123", kind: "layer", name: "orders", group: "api surface" }),
      makeUnit({ id: "a", parent: "u:layer:abc123" }),
    ];
    const scene = buildScene(units, []);
    const a = scene.nodes.find((n) => n.id === "a")!;
    expect(a.group).toBe("api surface");
  });

  it("gives a unit with no group an empty group", () => {
    const units = [makeUnit({ id: "a" })];
    const scene = buildScene(units, []);
    expect(scene.nodes[0]!.group).toBe("");
  });

  describe("regions", () => {
    it("produces one region per group when 2+ layers share a group, with a bounding box containing all member nodes", () => {
      const units = [
        makeUnit({ id: "u:layer:l1", kind: "layer", name: "orders", group: "api surface" }),
        makeUnit({ id: "u:layer:l2", kind: "layer", name: "billing", group: "api surface" }),
        makeUnit({ id: "a", parent: "u:layer:l1" }),
        makeUnit({ id: "b", parent: "u:layer:l2" }),
      ];
      const scene = buildScene(units, []);

      expect(scene.regions).toHaveLength(1);
      const region = scene.regions[0]!;
      expect(region.name).toBe("api surface");

      const a = scene.nodes.find((n) => n.id === "a")!;
      const b = scene.nodes.find((n) => n.id === "b")!;
      expect(region.x).toBeLessThanOrEqual(Math.min(a.x, b.x));
      expect(region.y).toBeLessThanOrEqual(Math.min(a.y, b.y));
      expect(region.x + region.w).toBeGreaterThanOrEqual(Math.max(a.x + a.w, b.x + b.w));
      expect(region.y + region.h).toBeGreaterThanOrEqual(Math.max(a.y + a.h, b.y + b.h));
    });

    it("produces no region for a group with only a single member node", () => {
      const units = [
        makeUnit({ id: "u:layer:l1", kind: "layer", name: "orders", group: "api surface" }),
        makeUnit({ id: "a", parent: "u:layer:l1" }),
      ];
      const scene = buildScene(units, []);
      expect(scene.regions).toHaveLength(0);
    });

    it("produces no region for units with no group", () => {
      const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
      const scene = buildScene(units, []);
      expect(scene.regions).toHaveLength(0);
    });

    it("produces a region around layer tiles themselves when 2+ layer tiles share a group (system-level view)", () => {
      const units = [
        makeUnit({ id: "u:layer:l1", kind: "layer", name: "orders", group: "api surface" }),
        makeUnit({ id: "u:layer:l2", kind: "layer", name: "billing", group: "api surface" }),
      ];
      const scene = buildScene(units, []);
      expect(scene.regions).toHaveLength(1);
      expect(scene.regions[0]!.name).toBe("api surface");
    });
  });
});

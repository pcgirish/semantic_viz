import { describe, expect, it } from "vitest";
import { buildScene, type BoundaryEdge } from "../src/layout.js";
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

/** A group unit and its member layers, reciprocally linked — the shape `groupOf` walks. */
function groupWithLayers(groupId: string, name: string, layerIds: string[]): Unit[] {
  return [
    makeUnit({ id: groupId, kind: "group", name, children: layerIds }),
    ...layerIds.map((id) => makeUnit({ id, kind: "layer", parent: groupId })),
  ];
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

  it("draws the dependency above its dependent (foundations at top)", () => {
    const units = [makeUnit({ id: "caller" }), makeUnit({ id: "callee" })];
    const edges = [makeEdge({ id: "e1", from: "caller", to: "callee" })];

    const scene = buildScene(units, edges);
    const caller = scene.nodes.find((n) => n.id === "caller")!;
    const callee = scene.nodes.find((n) => n.id === "callee")!;
    expect(callee.y).toBeLessThan(caller.y);
  });

  it("routes a dependency edge from the dependent's top border to the dependency's bottom border", () => {
    const units = [makeUnit({ id: "caller" }), makeUnit({ id: "callee" })];
    const edges = [makeEdge({ id: "e1", from: "caller", to: "callee" })];

    const scene = buildScene(units, edges);
    const caller = scene.nodes.find((n) => n.id === "caller")!;
    const callee = scene.nodes.find((n) => n.id === "callee")!;
    const link = scene.links[0]!;

    // from/to keep their logical meaning (markerEnd stays anchored at the callee) even
    // though the callee now renders above the caller.
    expect(link.from).toBe("caller");
    expect(link.to).toBe("callee");

    const start = link.path[0]!;
    const end = link.path[link.path.length - 1]!;
    expect(start.y).toBeCloseTo(caller.y);
    expect(end.y).toBeCloseTo(callee.y + callee.h);
    expect(end.y).toBeLessThan(start.y);
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

  it("carries the nearest layer ancestor's group unit id onto a scene node", () => {
    const units = [
      makeUnit({ id: "u:group:g1", kind: "group", name: "api surface", children: ["u:layer:abc123"] }),
      makeUnit({ id: "u:layer:abc123", kind: "layer", name: "orders", parent: "u:group:g1" }),
      makeUnit({ id: "a", parent: "u:layer:abc123" }),
    ];
    const scene = buildScene(units, []);
    const a = scene.nodes.find((n) => n.id === "a")!;
    expect(a.groupId).toBe("u:group:g1");
  });

  it("gives a unit under no group an empty groupId", () => {
    const units = [makeUnit({ id: "a" })];
    const scene = buildScene(units, []);
    expect(scene.nodes[0]!.groupId).toBe("");
  });

  describe("regions", () => {
    it("produces one region per group when 2+ layers share a group, with a bounding box containing all member nodes", () => {
      const units = [
        ...groupWithLayers("u:group:g1", "api surface", ["u:layer:l1", "u:layer:l2"]),
        makeUnit({ id: "a", parent: "u:layer:l1" }),
        makeUnit({ id: "b", parent: "u:layer:l2" }),
      ];
      const scene = buildScene(units, []);

      expect(scene.regions).toHaveLength(1);
      const region = scene.regions[0]!;
      // The region is identified by the group unit's id, and labelled with its display name —
      // the name is an LLM string that can change without the group's identity changing.
      expect(region.id).toBe("u:group:g1");
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
        ...groupWithLayers("u:group:g1", "api surface", ["u:layer:l1"]),
        makeUnit({ id: "a", parent: "u:layer:l1" }),
      ];
      const scene = buildScene(units, []);
      expect(scene.regions).toHaveLength(0);
    });

    it("produces no region for units under no group", () => {
      const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
      const scene = buildScene(units, []);
      expect(scene.regions).toHaveLength(0);
    });

    it("produces a region around layer tiles themselves when 2+ layer tiles share a group (system-level view)", () => {
      const units = groupWithLayers("u:group:g1", "api surface", ["u:layer:l1", "u:layer:l2"]);
      const scene = buildScene(units, []);
      expect(scene.regions).toHaveLength(1);
      expect(scene.regions[0]!.id).toBe("u:group:g1");
      expect(scene.regions[0]!.name).toBe("api surface");
    });
  });
});

describe("extrusion depth", () => {
  it("tracks sloc, monotonically and positively", () => {
    const units = [
      makeUnit({ id: "small", loc: { files: [], sloc: 5 } }),
      makeUnit({ id: "big", loc: { files: [], sloc: 500 } }),
    ];

    const scene = buildScene(units, []);
    const small = scene.nodes.find((n) => n.id === "small")!;
    const big = scene.nodes.find((n) => n.id === "big")!;

    expect(small.depth).toBeGreaterThan(0);
    expect(big.depth).toBeGreaterThan(small.depth);
  });

  it("makes a modest unit stand taller than its footprint is wide", () => {
    // The 3D skins read `depth` as world height against a footprint measured in the same
    // units, so the ratio between them is what decides whether a scene reads as a skyline or
    // as a plain of slabs. On fixtures/orderly the layer nodes are 96 wide with depths of
    // 4-26 — four times wider than tall — and at eye level there is nothing to walk between.
    // A unit of unremarkable size should read as a building.
    const scene = buildScene([makeUnit({ id: "a", loc: { files: [], sloc: 40 } })], []);
    const n = scene.nodes[0]!;
    expect(n.depth).toBeGreaterThan(Math.max(n.w, n.h));
  });

  it("gives equal-sloc units equal depth", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    const scene = buildScene(units, []);
    expect(scene.nodes[0]!.depth).toBe(scene.nodes[1]!.depth);
  });

  it("compresses the range so one large file cannot flatten the skyline", () => {
    // Raw sloc is too skewed to drive a visual channel directly — the same reason
    // docs/serve.md#2 √-scales tile *area* rather than using sloc raw. Height had kept the
    // linear scale, so a 2000-line file stood 40x a 50-line one and everything else became
    // noise at the feet of one tower. The curve is √ for the same reason area's is: it keeps
    // the ordering intact while pulling the extremes back into one legible skyline.
    const depth = (sloc: number) =>
      buildScene([makeUnit({ id: "a", loc: { files: [], sloc } })], []).nodes[0]!.depth;
    const ratio = depth(2000) / depth(50);
    expect(ratio).toBeLessThan(8);
    // Still clearly taller, though — compression must not become erasure.
    expect(ratio).toBeGreaterThan(2);
  });

  it("keeps height strictly increasing in sloc, so the compression never flattens a pair", () => {
    const depth = (sloc: number) =>
      buildScene([makeUnit({ id: "a", loc: { files: [], sloc } })], []).nodes[0]!.depth;
    const samples = [0, 1, 5, 20, 100, 500, 2000, 10000].map(depth);
    for (let i = 1; i < samples.length; i++) expect(samples[i]!).toBeGreaterThan(samples[i - 1]!);
  });

  it("stands even a trivial unit taller than its footprint is wide", () => {
    // The Checkpoint 2 constraint, pinned at the bottom of the range rather than the middle.
    // On fixtures/orderly the median unit is 2 sloc, so a curve tuned to keep the *median*
    // above the footprint still leaves most of the city as slabs — the floor is what the
    // constraint actually rests on, and it has to clear MIN_DIM (96) on its own.
    const scene = buildScene([makeUnit({ id: "a", loc: { files: [], sloc: 0 } })], []);
    const n = scene.nodes[0]!;
    expect(n.depth).toBeGreaterThan(Math.max(n.w, n.h));
  });
});

describe("boundary markers", () => {
  // An edge with exactly one endpoint inside the focused subtree renders to a collapsed
  // external endpoint: a real SceneNode carrying `boundary`, whose `id` IS the off-screen
  // unit, so drill/hover/search need no synthetic id space.
  const inside = [makeUnit({ id: "in-a" }), makeUnit({ id: "in-b" })];
  const externals = [makeUnit({ id: "ext-1", name: "Billing" }), makeUnit({ id: "ext-2", name: "Auth" })];

  function boundary(overrides: Partial<BoundaryEdge> & { edge: Edge }): BoundaryEdge {
    return { external: "ext-1", direction: "out", ...overrides };
  }

  it("emits one marker per external sibling, carrying the contributing count", () => {
    const scene = buildScene(inside, [], {
      externalUnits: externals,
      boundaryEdges: [boundary({ edge: makeEdge({ id: "e1", from: "in-a", to: "ext-1" }) })],
    });

    const markers = scene.nodes.filter((n) => n.boundary);
    expect(markers).toHaveLength(1);
    expect(markers[0]!.id).toBe("ext-1");
    expect(markers[0]!.name).toBe("Billing");
    expect(markers[0]!.boundary).toEqual({ edgeCount: 1, weight: 1, direction: "out", inCount: 0, outCount: 1 });
  });

  it("collapses two edges to the same external into one marker", () => {
    const scene = buildScene(inside, [], {
      externalUnits: externals,
      boundaryEdges: [
        boundary({ edge: makeEdge({ id: "e1", from: "in-a", to: "ext-1", weight: 2 }) }),
        boundary({ edge: makeEdge({ id: "e2", from: "in-b", to: "ext-1", weight: 3 }) }),
      ],
    });

    const markers = scene.nodes.filter((n) => n.boundary);
    expect(markers).toHaveLength(1);
    expect(markers[0]!.boundary).toEqual({ edgeCount: 2, weight: 5, direction: "out", inCount: 0, outCount: 2 });
  });

  it("mirrors direction for an inbound-only external", () => {
    const scene = buildScene(inside, [], {
      externalUnits: externals,
      boundaryEdges: [boundary({ edge: makeEdge({ id: "e1", from: "ext-1", to: "in-a" }), direction: "in" })],
    });

    expect(scene.nodes.find((n) => n.boundary)!.boundary).toEqual({
      edgeCount: 1, weight: 1, direction: "in", inCount: 1, outCount: 0,
    });
  });

  it("merges a bidirectional pair into one marker with direction 'both'", () => {
    // The assertion that fails under both rejected designs: a marker per direction would put
    // two nodes with the same `id` in Scene.nodes, and a two-value `direction` could not
    // describe a sibling that is both called and calling.
    const scene = buildScene(inside, [], {
      externalUnits: externals,
      boundaryEdges: [
        boundary({ edge: makeEdge({ id: "e1", from: "in-a", to: "ext-1" }), direction: "out" }),
        boundary({ edge: makeEdge({ id: "e2", from: "ext-1", to: "in-b" }), direction: "in" }),
      ],
    });

    const markers = scene.nodes.filter((n) => n.boundary);
    expect(markers).toHaveLength(1);
    expect(markers[0]!.boundary).toEqual({ edgeCount: 2, weight: 2, direction: "both", inCount: 1, outCount: 1 });
    expect(new Set(scene.nodes.map((n) => n.id)).size).toBe(scene.nodes.length);
  });

  it("produces no markers when nothing crosses the boundary", () => {
    const scene = buildScene(inside, [makeEdge({ id: "e1", from: "in-a", to: "in-b" })]);
    expect(scene.nodes.filter((n) => n.boundary)).toHaveLength(0);
    expect(scene.nodes.every((n) => n.boundary === undefined)).toBe(true);
  });

  it("clamps markers to the frame edge and spreads them so they do not overlap", () => {
    const scene = buildScene(inside, [], {
      externalUnits: externals,
      boundaryEdges: [
        boundary({ edge: makeEdge({ id: "e1", from: "in-a", to: "ext-1" }), external: "ext-1" }),
        boundary({ edge: makeEdge({ id: "e2", from: "ext-2", to: "in-b" }), external: "ext-2", direction: "in" }),
      ],
    });

    const markers = scene.nodes.filter((n) => n.boundary).sort((a, b) => a.y - b.y);
    expect(markers).toHaveLength(2);
    // Sorted by id, so placement does not depend on input order.
    expect(markers.map((m) => m.id)).toEqual(["ext-1", "ext-2"]);
    expect(markers[0]!.y + markers[0]!.h).toBeLessThanOrEqual(markers[1]!.y);
    // Outside the interior nodes' x-extent: the markers sit on the frame, not among the tiles.
    const interiorMaxX = Math.max(...scene.nodes.filter((n) => !n.boundary).map((n) => n.x + n.w));
    for (const m of markers) expect(m.x).toBeGreaterThanOrEqual(interiorMaxX);
  });

  it("keeps markers out of regions, which describe the focused subtree only", () => {
    const scene = buildScene(
      groupWithLayers("u:group:core", "core", ["l1", "l2"]),
      [],
      {
        externalUnits: externals,
        boundaryEdges: [boundary({ edge: makeEdge({ id: "e1", from: "l1", to: "ext-1" }) })],
      },
    );

    const region = scene.regions.find((r) => r.id === "u:group:core")!;
    const marker = scene.nodes.find((n) => n.boundary)!;
    expect(marker.x).toBeGreaterThanOrEqual(region.x + region.w);
  });
});

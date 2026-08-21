import { describe, expect, it } from "vitest";
import type { Edge, Unit } from "@scv/schema";
import { collectBoundaryEdges } from "../src/App.js";

function unit(id: string, kind: Unit["kind"], children: string[] = [], parent: string | null = null): Unit {
  return {
    id, kind, name: id, qualname: id, parent, children,
    loc: { files: [], sloc: 10 },
    tags: [], metrics: {},
    hash: { struct: null, text: null, semantic: null },
    provenance: { source: "static" },
  };
}

function edge(id: string, from: string, to: string, weight = 1): Edge {
  return { id, from, to, kind: "calls", weight, source: "static", confidence: 1 };
}

/**
 * system
 *  ├─ g1 (focused) ─ l1 ─ m1
 *  └─ g2           ─ l2 ─ m2
 */
const units = [
  unit("sys", "system", ["g1", "g2"]),
  unit("g1", "group", ["l1"], "sys"),
  unit("g2", "group", ["l2"], "sys"),
  unit("l1", "layer", ["m1"], "g1"),
  unit("l2", "layer", ["m2"], "g2"),
  unit("m1", "module", [], "l1"),
  unit("m2", "module", [], "l2"),
];
const unitsById = new Map(units.map((u) => [u.id, u]));

describe("collectBoundaryEdges", () => {
  it("collapses an outbound cross-boundary edge onto the focused unit's sibling", () => {
    // m1 -> m2 has no visible endpoint at group focus: their nearest common ancestor is the
    // system, which is not rendered. It resolves to g1's sibling g2, which is.
    const result = collectBoundaryEdges({
      focusedUnit: unitsById.get("g1")!,
      visibleUnits: [unitsById.get("l1")!],
      edges: [edge("e1", "m1", "m2")],
      unitsById,
    });

    expect(result.boundaryEdges).toEqual([{ edge: expect.objectContaining({ id: "e1" }), external: "g2", direction: "out" }]);
    expect(result.externalUnits.map((u) => u.id)).toEqual(["g2"]);
  });

  it("marks an inbound edge as 'in'", () => {
    const result = collectBoundaryEdges({
      focusedUnit: unitsById.get("g1")!,
      visibleUnits: [unitsById.get("l1")!],
      edges: [edge("e1", "m2", "m1")],
      unitsById,
    });

    expect(result.boundaryEdges.map((b) => b.direction)).toEqual(["in"]);
  });

  it("ignores edges with both endpoints inside the focus", () => {
    const result = collectBoundaryEdges({
      focusedUnit: unitsById.get("g1")!,
      visibleUnits: [unitsById.get("l1")!],
      edges: [edge("e1", "m1", "m1")],
      unitsById,
    });

    expect(result.boundaryEdges).toEqual([]);
    expect(result.externalUnits).toEqual([]);
  });

  it("returns nothing at root focus, where every unit is already on screen", () => {
    // Nothing is outside the system, so a boundary cannot be crossed.
    const result = collectBoundaryEdges({
      focusedUnit: unitsById.get("sys")!,
      visibleUnits: [unitsById.get("g1")!, unitsById.get("g2")!],
      edges: [edge("e1", "m1", "m2")],
      unitsById,
    });

    expect(result.boundaryEdges).toEqual([]);
  });

  it("lists each external unit once even when several edges reach it", () => {
    const result = collectBoundaryEdges({
      focusedUnit: unitsById.get("g1")!,
      visibleUnits: [unitsById.get("l1")!],
      edges: [edge("e1", "m1", "m2"), edge("e2", "m2", "m1")],
      unitsById,
    });

    expect(result.boundaryEdges).toHaveLength(2);
    expect(result.externalUnits.map((u) => u.id)).toEqual(["g2"]);
  });
});

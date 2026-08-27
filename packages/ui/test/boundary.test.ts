import { describe, expect, it } from "vitest";
import type { Edge, Unit } from "@scv/schema";
import { collectBoundaryEdges, summariseSiblings } from "../src/App.js";

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

    expect(result.boundaryEdges).toEqual([
      { edge: expect.objectContaining({ id: "e1" }), external: "g2", interior: "l1", direction: "out" },
    ]);
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

/**
 * A wider fixture: g1 is focused and has two visible member layers, plus three siblings —
 * one heavily coupled, one lightly, one not at all.
 *
 * system
 *  ├─ g1 (focused) ─ l1 ─ m1
 *  │                └ l1b ─ m1b
 *  ├─ g2 ─ l2 ─ m2
 *  ├─ g3 ─ l3 ─ m3
 *  └─ g4 ─ l4 ─ m4        (no crossing edges)
 */
const wideUnits = [
  unit("sys", "system", ["g1", "g2", "g3", "g4"]),
  unit("g1", "group", ["l1", "l1b"], "sys"),
  unit("g2", "group", ["l2"], "sys"),
  unit("g3", "group", ["l3"], "sys"),
  unit("g4", "group", ["l4"], "sys"),
  unit("l1", "layer", ["m1"], "g1"),
  unit("l1b", "layer", ["m1b"], "g1"),
  unit("l2", "layer", ["m2"], "g2"),
  unit("l3", "layer", ["m3"], "g3"),
  unit("l4", "layer", ["m4"], "g4"),
  unit("m1", "module", [], "l1"),
  unit("m1b", "module", [], "l1b"),
  unit("m2", "module", [], "l2"),
  unit("m3", "module", [], "l3"),
  unit("m4", "module", [], "l4"),
];
const wideById = new Map(wideUnits.map((u) => [u.id, u]));

/** Runs the real collect->summarise pipeline, so the two stay honest about their contract. */
function summarise(edges: Edge[], focused = "g1", visible = ["l1", "l1b"]) {
  const focusedUnit = wideById.get(focused)!;
  const { boundaryEdges } = collectBoundaryEdges({
    focusedUnit,
    visibleUnits: visible.map((id) => wideById.get(id)!),
    edges,
    unitsById: wideById,
  });
  return summariseSiblings({ focusedUnit, boundaryEdges, unitsById: wideById });
}

describe("collectBoundaryEdges: interior endpoint", () => {
  it("resolves the interior endpoint to the visible ancestor, not the deep leaf it started at", () => {
    // The edge leaves m1, which is two levels below the focus and has no tile. The tray needs
    // the tile the connector will actually attach to, which is l1.
    const result = collectBoundaryEdges({
      focusedUnit: wideById.get("g1")!,
      visibleUnits: [wideById.get("l1")!, wideById.get("l1b")!],
      edges: [edge("e1", "m1", "m2")],
      unitsById: wideById,
    });

    expect(result.boundaryEdges.map((b) => b.interior)).toEqual(["l1"]);
  });
});

describe("summariseSiblings", () => {
  it("folds several edges between the same tile and sibling into one link, summing weight", () => {
    const rows = summarise([edge("e1", "m1", "m2", 2), edge("e2", "m1", "m2", 3)]);
    const g2 = rows.find((r) => r.id === "g2")!;

    expect(g2.tiles).toEqual([{ interior: "l1", edgeCount: 2, weight: 5, direction: "out" }]);
    // The row counts edges, not links: two edges cross, so the row says two.
    expect(g2.edgeCount).toBe(2);
  });

  it("keeps each tile's direction independent of the row's", () => {
    // l1 only calls out; l1b is only called into. The row as a whole is therefore "both",
    // but neither tile is — a per-tile "both" would misdescribe both connectors.
    const rows = summarise([edge("e1", "m1", "m2"), edge("e2", "m2", "m1b")]);
    const g2 = rows.find((r) => r.id === "g2")!;

    expect(g2.direction).toBe("both");
    expect(Object.fromEntries(g2.tiles.map((t) => [t.interior, t.direction]))).toEqual({ l1: "out", l1b: "in" });
  });

  it("marks a single tile coupled both ways as 'both'", () => {
    const rows = summarise([edge("e1", "m1", "m2"), edge("e2", "m2", "m1")]);
    const g2 = rows.find((r) => r.id === "g2")!;

    expect(g2.tiles).toEqual([{ interior: "l1", edgeCount: 2, weight: 2, direction: "both" }]);
  });

  it("lists a sibling with no crossing edges rather than dropping it", () => {
    // Omitting it is indistinguishable from a bug: the reader cannot tell "not coupled" from
    // "not computed".
    const rows = summarise([edge("e1", "m1", "m2")]);
    const g4 = rows.find((r) => r.id === "g4")!;

    expect(g4).toMatchObject({ tiles: [], edgeCount: 0, direction: null, inCount: 0, outCount: 0 });
  });

  it("sorts rows by edge count descending and tiles within a row the same way", () => {
    const rows = summarise([
      edge("e1", "m1", "m3"),
      edge("e2", "m1", "m2"),
      edge("e3", "m1", "m2"),
      edge("e4", "m1b", "m2"),
    ]);

    // g2 has three crossing edges, g3 one, g4 none — and the unlinked row sorts last.
    expect(rows.map((r) => r.id)).toEqual(["g2", "g3", "g4"]);
    // Within g2, l1 carries two of the three edges, so it anchors the highlight.
    expect(rows[0]!.tiles.map((t) => t.interior)).toEqual(["l1", "l1b"]);
  });

  it("returns no rows when the focused unit has no siblings", () => {
    expect(summarise([edge("e1", "m1", "m2")], "sys", ["g1", "g2", "g3", "g4"])).toEqual([]);
  });

  it("works the same at layer focus, where the siblings are layers rather than groups", () => {
    // Siblings are whatever kind the focused unit is; nothing in the summary names a kind.
    const rows = summarise([edge("e1", "m1", "m1b")], "l1", ["m1"]);

    expect(rows.map((r) => r.id)).toEqual(["l1b"]);
    expect(rows[0]!.tiles).toEqual([{ interior: "m1", edgeCount: 1, weight: 1, direction: "out" }]);
  });
});

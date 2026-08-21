import { describe, expect, it } from "vitest";
import {
  validateEdgeInvariants,
  validateSnapshotInvariants,
  validateTreeInvariants,
  type Edge,
  type Snapshot,
  type Unit,
} from "../src/index.js";

function unit(over: Partial<Unit> & Pick<Unit, "id">): Unit {
  return {
    kind: "module",
    name: over.id,
    qualname: over.id,
    parent: null,
    children: [],
    loc: { files: [], start: null, end: null, sloc: 1 },
    semantics: null,
    cost: null,
    tags: [],
    metrics: {},
    hash: { struct: null, text: null, semantic: null },
    provenance: { source: "static" },
    ...over,
  };
}

/** system -> layer -> module, reciprocal in both directions. */
function healthyTree(): Unit[] {
  return [
    unit({ id: "sys", kind: "system", parent: null, children: ["lay"] }),
    unit({ id: "lay", kind: "layer", parent: "sys", children: ["mod"] }),
    unit({ id: "mod", kind: "module", parent: "lay", children: [] }),
  ];
}

function edge(over: Partial<Edge> & Pick<Edge, "id" | "from" | "to">): Edge {
  return {
    kind: "calls",
    weight: 1,
    source: "static",
    confidence: 1,
    ...over,
  };
}

const errorTypes = (findings: { severity: string; type: string }[]) =>
  findings.filter((f) => f.severity === "error").map((f) => f.type);

describe("validateTreeInvariants", () => {
  it("accepts a reciprocal single-root tree", () => {
    const result = validateTreeInvariants(healthyTree());
    expect(result.findings).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects a non-system unit with a null parent", () => {
    const units = healthyTree().map((u) => (u.id === "lay" ? { ...u, parent: null } : u));
    const result = validateTreeInvariants(units);
    expect(result.valid).toBe(false);
    expect(errorTypes(result.findings)).toContain("orphan");
  });

  it("rejects two system roots", () => {
    const units = [...healthyTree(), unit({ id: "sys2", kind: "system", parent: null })];
    const result = validateTreeInvariants(units);
    expect(result.valid).toBe(false);
    expect(errorTypes(result.findings)).toContain("multiple_roots");
  });

  it("rejects no system root at all", () => {
    const result = validateTreeInvariants([unit({ id: "mod", parent: null })]);
    expect(result.valid).toBe(false);
    expect(errorTypes(result.findings)).toContain("no_root");
  });

  it("rejects a parent id that resolves to nothing", () => {
    const units = healthyTree().map((u) => (u.id === "mod" ? { ...u, parent: "ghost" } : u));
    const result = validateTreeInvariants(units);
    expect(result.valid).toBe(false);
    expect(errorTypes(result.findings)).toContain("unresolved_parent");
  });

  it("rejects a child id that resolves to nothing", () => {
    const units = healthyTree().map((u) => (u.id === "lay" ? { ...u, children: ["mod", "ghost"] } : u));
    const result = validateTreeInvariants(units);
    expect(result.valid).toBe(false);
    expect(errorTypes(result.findings)).toContain("unresolved_child");
  });

  it("rejects a child that does not name its parent back", () => {
    // The exact break Phase 1 fixed: listed in children, but parent: null upward.
    const units = healthyTree().map((u) => (u.id === "lay" ? { ...u, parent: null } : u));
    const result = validateTreeInvariants(units);
    expect(errorTypes(result.findings)).toContain("orphan");
  });

  it("rejects a parent that does not list its child", () => {
    const units = healthyTree().map((u) => (u.id === "lay" ? { ...u, children: [] } : u));
    const result = validateTreeInvariants(units);
    expect(result.valid).toBe(false);
    expect(errorTypes(result.findings)).toContain("missing_child_link");
  });

  it("rejects a cycle", () => {
    const units = [
      unit({ id: "sys", kind: "system", parent: null, children: ["a"] }),
      unit({ id: "a", parent: "sys", children: ["b"] }),
      unit({ id: "b", parent: "a", children: ["a"] }),
    ];
    const result = validateTreeInvariants(units);
    expect(result.valid).toBe(false);
    expect(errorTypes(result.findings)).toContain("cycle");
  });

  it("rejects a unit unreachable from the system", () => {
    // Mutually parented pair, reciprocal between themselves, detached from the root.
    const units = [
      ...healthyTree(),
      unit({ id: "x", parent: "y", children: ["y"] }),
      unit({ id: "y", parent: "x", children: ["x"] }),
    ];
    const result = validateTreeInvariants(units);
    expect(result.valid).toBe(false);
    expect(errorTypes(result.findings)).toContain("unreachable");
  });

  it("rejects a unit reachable twice (a diamond)", () => {
    const units = [
      unit({ id: "sys", kind: "system", parent: null, children: ["a", "b"] }),
      unit({ id: "a", parent: "sys", children: ["shared"] }),
      unit({ id: "b", parent: "sys", children: ["shared"] }),
      unit({ id: "shared", parent: "a", children: [] }),
    ];
    const result = validateTreeInvariants(units);
    expect(result.valid).toBe(false);
    expect(errorTypes(result.findings)).toContain("multiple_parents");
  });

  it("rejects a module under an unclustered ancestor that is also under a layer", () => {
    const units = [
      unit({ id: "sys", kind: "system", parent: null, children: ["lay", "unc"] }),
      unit({ id: "lay", kind: "layer", parent: "sys", children: ["mod"] }),
      unit({ id: "unc", kind: "unclustered", parent: "sys", children: ["mod"] }),
      unit({ id: "mod", parent: "lay", children: [] }),
    ];
    const result = validateTreeInvariants(units);
    expect(result.valid).toBe(false);
    expect(errorTypes(result.findings)).toContain("multiple_parents");
  });

  it("names the offending unit on every finding", () => {
    const units = healthyTree().map((u) => (u.id === "lay" ? { ...u, parent: null } : u));
    const result = validateTreeInvariants(units);
    for (const finding of result.findings) expect(finding.unit).toBeTruthy();
  });
});

describe("validateEdgeInvariants", () => {
  const ids = new Set(["a", "b"]);

  it("accepts plain non-rollup edges", () => {
    const result = validateEdgeInvariants([edge({ id: "e1", from: "a", to: "b" })], ids);
    expect(result.findings).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects an edge endpoint that resolves to nothing", () => {
    const result = validateEdgeInvariants([edge({ id: "e1", from: "a", to: "ghost" })], ids);
    expect(result.valid).toBe(false);
    expect(errorTypes(result.findings)).toContain("unresolved_endpoint");
  });

  it("warns — but stays valid — on a legacy bare rollup", () => {
    // A snapshot written before rollupProvenance existed must still load.
    const result = validateEdgeInvariants(
      [edge({ id: "e1", from: "a", to: "b", rollup: true })],
      ids,
    );
    expect(result.valid).toBe(true);
    expect(result.findings.map((f) => f.severity)).toEqual(["warning"]);
    expect(result.findings[0]?.type).toBe("missing_rollup_provenance");
  });

  it("accepts a well-formed rollup", () => {
    const contributors = [
      edge({ id: "c1", from: "a", to: "b", weight: 2 }),
      edge({ id: "c2", from: "a", to: "b", weight: 3 }),
    ];
    const result = validateEdgeInvariants(
      [
        ...contributors,
        edge({
          id: "r1",
          from: "a",
          to: "b",
          weight: 5,
          rollup: true,
          rollupProvenance: { edges: ["c1", "c2"], count: 2, weight: 5 },
        }),
      ],
      ids,
    );
    expect(result.findings).toEqual([]);
  });

  it("rejects rollupProvenance on an edge that is not a rollup", () => {
    const result = validateEdgeInvariants(
      [
        edge({ id: "c1", from: "a", to: "b", weight: 1 }),
        edge({
          id: "r1",
          from: "a",
          to: "b",
          rollupProvenance: { edges: ["c1"], count: 1, weight: 1 },
        }),
      ],
      ids,
    );
    expect(errorTypes(result.findings)).toContain("rollup_provenance_without_flag");
  });

  const wellFormed = () => [
    edge({ id: "c1", from: "a", to: "b", weight: 2 }),
    edge({ id: "c2", from: "a", to: "b", weight: 3 }),
  ];

  const withProvenance = (p: { edges: string[]; count: number; weight: number }) =>
    validateEdgeInvariants(
      [...wellFormed(), edge({ id: "r1", from: "a", to: "b", weight: 5, rollup: true, rollupProvenance: p })],
      ids,
    );

  it("rejects an empty contributor list", () => {
    expect(errorTypes(withProvenance({ edges: [], count: 0, weight: 0 }).findings)).toContain(
      "empty_rollup",
    );
  });

  it("rejects duplicate contributors", () => {
    expect(
      errorTypes(withProvenance({ edges: ["c1", "c1"], count: 2, weight: 4 }).findings),
    ).toContain("duplicate_rollup_edges");
  });

  it("rejects unsorted contributors", () => {
    expect(
      errorTypes(withProvenance({ edges: ["c2", "c1"], count: 2, weight: 5 }).findings),
    ).toContain("unsorted_rollup_edges");
  });

  it("rejects a contributor that resolves to no edge", () => {
    expect(
      errorTypes(withProvenance({ edges: ["c1", "ghost"], count: 2, weight: 2 }).findings),
    ).toContain("unresolved_rollup_edge");
  });

  it("rejects a count that disagrees with the list", () => {
    expect(
      errorTypes(withProvenance({ edges: ["c1", "c2"], count: 3, weight: 5 }).findings),
    ).toContain("rollup_count_mismatch");
  });

  it("rejects a weight that disagrees with the contributors", () => {
    expect(
      errorTypes(withProvenance({ edges: ["c1", "c2"], count: 2, weight: 99 }).findings),
    ).toContain("rollup_weight_mismatch");
  });

  it("rejects a nested rollup", () => {
    const result = validateEdgeInvariants(
      [
        edge({ id: "c1", from: "a", to: "b", weight: 2 }),
        edge({
          id: "c2",
          from: "a",
          to: "b",
          weight: 3,
          rollup: true,
          rollupProvenance: { edges: ["c1"], count: 1, weight: 2 },
        }),
        edge({
          id: "r1",
          from: "a",
          to: "b",
          weight: 5,
          rollup: true,
          rollupProvenance: { edges: ["c1", "c2"], count: 2, weight: 5 },
        }),
      ],
      ids,
    );
    expect(errorTypes(result.findings)).toContain("nested_rollup");
  });
});

describe("validateSnapshotInvariants", () => {
  const snapshot = (units: Unit[], edges: Edge[]): Snapshot => ({
    schema: "scv/1",
    snapshot_id: "s",
    repo: { root: "r", vcs: "git" },
    rev: { sha: "abc", kind: "commit", ts: "2026-01-01T00:00:00Z", author: "a", author_kind: "human" },
    provenance: { extractor: "e", interpreter: { model: "m", prompt_rev: "p" } },
    units,
    edges,
    externals: [],
  });

  it("runs both validators and reports findings from each", () => {
    const units = healthyTree().map((u) => (u.id === "lay" ? { ...u, parent: null } : u));
    const result = validateSnapshotInvariants(
      snapshot(units, [edge({ id: "e1", from: "sys", to: "ghost" })]),
    );
    expect(result.valid).toBe(false);
    const types = errorTypes(result.findings);
    expect(types).toContain("orphan");
    expect(types).toContain("unresolved_endpoint");
  });

  it("does not report `ext:` import targets as unresolved endpoints", () => {
    // Import edges point at `ext:<module>` — a module path, not a unit and not an external
    // (externals are pinned packages, `x:pypi:fastapi@0.110.0`). The extractor never registers
    // a node for them, deliberately: `ext:os` is stdlib and has no unit to resolve to. Treating
    // them as broken references made every real analyze run throw.
    const result = validateSnapshotInvariants(
      snapshot(healthyTree(), [edge({ id: "e1", from: "mod", to: "ext:fastapi" })]),
    );
    expect(result.findings).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("still reports a non-`ext:` endpoint that resolves to nothing", () => {
    const result = validateSnapshotInvariants(
      snapshot(healthyTree(), [edge({ id: "e1", from: "mod", to: "ghost" })]),
    );
    expect(errorTypes(result.findings)).toContain("unresolved_endpoint");
  });

  it("is valid for a clean snapshot", () => {
    const result = validateSnapshotInvariants(
      snapshot(healthyTree(), [edge({ id: "e1", from: "lay", to: "mod" })]),
    );
    expect(result.findings).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("stays valid when the only finding is a warning", () => {
    const result = validateSnapshotInvariants(
      snapshot(healthyTree(), [edge({ id: "e1", from: "lay", to: "mod", rollup: true })]),
    );
    expect(result.valid).toBe(true);
    expect(result.findings.map((f) => f.severity)).toEqual(["warning"]);
  });
});

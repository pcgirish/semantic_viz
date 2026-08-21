import { describe, expect, it } from "vitest";
import { runDiffer } from "../src/diff.js";
import type { Snapshot, Unit, Edge } from "@scv/schema";

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: "u:py:src.a#f",
    kind: "function",
    name: "a",
    qualname: "src.a",
    lang: "python",
    parent: null,
    children: [],
    loc: { files: ["src/a.py"], start: 1, end: 5, sloc: 4 },
    signature: null,
    semantics: null,
    cost: null,
    tags: [],
    metrics: {},
    authors: [],
    hash: { struct: "s1", text: "t1", semantic: null },
    provenance: { source: "static" },
    ...overrides,
  };
}

function makeSnapshot(units: Unit[], edges: Edge[] = [], sha = "aaa1111"): Snapshot {
  return {
    schema: "scv/1",
    snapshot_id: `snap-${sha}`,
    repo: { root: "orderly", vcs: "git" },
    rev: { sha, kind: "commit", author: "a", author_kind: "human", ts: "2026-01-01T00:00:00Z" },
    provenance: { extractor: "scv-ts/0.1.0", interpreter: { model: "none", prompt_rev: "none" } },
    units,
    edges,
    externals: [],
  };
}

describe("runDiffer", () => {
  it("marks a unit present only in b as added, with amount 1", () => {
    const a = makeSnapshot([]);
    const b = makeSnapshot([makeUnit()]);

    const delta = runDiffer(a, b);

    expect(delta.unit_deltas).toHaveLength(1);
    expect(delta.unit_deltas[0]).toMatchObject({ unit: "u:py:src.a#f", status: "added", amount: 1 });
  });

  it("marks a unit present only in a as removed, with amount 1", () => {
    const a = makeSnapshot([makeUnit()]);
    const b = makeSnapshot([]);

    const delta = runDiffer(a, b);

    expect(delta.unit_deltas[0]).toMatchObject({ status: "removed", amount: 1 });
  });

  it("omits unchanged units (same hashes) from unit_deltas", () => {
    const unit = makeUnit();
    const a = makeSnapshot([unit]);
    const b = makeSnapshot([unit]);

    const delta = runDiffer(a, b);

    expect(delta.unit_deltas).toHaveLength(0);
  });

  it("marks a unit as modified when its text hash changes, with amount > 0", () => {
    const a = makeSnapshot([makeUnit({ hash: { struct: "s1", text: "t1", semantic: null } })]);
    const b = makeSnapshot([makeUnit({ hash: { struct: "s1", text: "t2", semantic: null } })]);

    const delta = runDiffer(a, b);

    expect(delta.unit_deltas[0]?.status).toBe("modified");
    expect(delta.unit_deltas[0]?.amount).toBeGreaterThan(0);
  });

  it("computes blast radius as transitive incoming edges, capped at depth 4", () => {
    // chain: d -> c -> b -> a -> target ; target has 5 transitive ancestors upstream if uncapped
    const target = makeUnit({ id: "u:t", qualname: "t" });
    const n1 = makeUnit({ id: "u:1", qualname: "n1" });
    const n2 = makeUnit({ id: "u:2", qualname: "n2" });
    const n3 = makeUnit({ id: "u:3", qualname: "n3" });
    const n4 = makeUnit({ id: "u:4", qualname: "n4" });
    const n5 = makeUnit({ id: "u:5", qualname: "n5" });
    const edges: Edge[] = [
      { id: "e1", from: "u:1", to: "u:t", kind: "calls", weight: 1, source: "static", confidence: 1 },
      { id: "e2", from: "u:2", to: "u:1", kind: "calls", weight: 1, source: "static", confidence: 1 },
      { id: "e3", from: "u:3", to: "u:2", kind: "calls", weight: 1, source: "static", confidence: 1 },
      { id: "e4", from: "u:4", to: "u:3", kind: "calls", weight: 1, source: "static", confidence: 1 },
      { id: "e5", from: "u:5", to: "u:4", kind: "calls", weight: 1, source: "static", confidence: 1 },
    ];
    const a = makeSnapshot([]);
    const b = makeSnapshot([target, n1, n2, n3, n4, n5], edges);

    const delta = runDiffer(a, b);

    const targetDelta = delta.unit_deltas.find((d) => d.unit === "u:t");
    expect(targetDelta?.blast_radius.direct).toBe(1);
    expect(targetDelta?.blast_radius.transitive).toBe(4);
  });

  it("flags public_api true when the unit is tagged public-api or auth-boundary", () => {
    const a = makeSnapshot([]);
    const b = makeSnapshot([makeUnit({ tags: ["public-api"] })]);

    const delta = runDiffer(a, b);

    expect(delta.unit_deltas[0]?.blast_radius.public_api).toBe(true);
  });

  it("produces edge deltas for added, removed, and reweighted edges", () => {
    const u1 = makeUnit({ id: "u:1", qualname: "n1" });
    const u2 = makeUnit({ id: "u:2", qualname: "n2" });
    const edgeSame: Edge = { id: "e:same", from: "u:1", to: "u:2", kind: "calls", weight: 1, source: "static", confidence: 1 };
    const edgeRemoved: Edge = { id: "e:rm", from: "u:1", to: "u:2", kind: "imports", weight: 1, source: "static", confidence: 1 };
    const edgeReweighted: Edge = { id: "e:rw", from: "u:1", to: "u:2", kind: "inherits", weight: 1, source: "static", confidence: 1 };
    const edgeAdded: Edge = { id: "e:add", from: "u:2", to: "u:1", kind: "calls", weight: 1, source: "static", confidence: 1 };

    const a = makeSnapshot([u1, u2], [edgeSame, edgeRemoved, { ...edgeReweighted, weight: 1 }]);
    const b = makeSnapshot([u1, u2], [edgeSame, { ...edgeReweighted, weight: 3 }, edgeAdded]);

    const delta = runDiffer(a, b);

    const statuses = Object.fromEntries(delta.edge_deltas.map((d) => [d.edge, d.status]));
    expect(statuses["e:rm"]).toBe("removed");
    expect(statuses["e:add"]).toBe("added");
    expect(statuses["e:rw"]).toBe("reweighted");
    expect(statuses["e:same"]).toBeUndefined();
  });

  it("rolls up amount (sloc-weighted mean) and risk (max) to ancestors", () => {
    const parent = makeUnit({
      id: "u:parent",
      qualname: "parent",
      kind: "module",
      children: ["u:child1", "u:child2"],
      loc: { files: ["p.py"], start: null, end: null, sloc: 10 },
    });
    const child1 = makeUnit({ id: "u:child1", qualname: "child1", parent: "u:parent", loc: { files: ["p.py"], start: 1, end: 3, sloc: 3 } });
    const child2 = makeUnit({ id: "u:child2", qualname: "child2", parent: "u:parent", loc: { files: ["p.py"], start: 4, end: 10, sloc: 7 } });

    const a = makeSnapshot([
      parent,
      { ...child1, hash: { struct: "s1", text: "t1", semantic: null } },
      { ...child2, hash: { struct: "s1", text: "t1", semantic: null } },
    ]);
    const b = makeSnapshot([
      parent,
      { ...child1, hash: { struct: "s1", text: "t1-changed", semantic: null } },
      { ...child2, hash: { struct: "s1", text: "t1", semantic: null } },
    ]);

    const delta = runDiffer(a, b);

    expect(delta.rollup["u:parent"]).toBeDefined();
    expect(delta.rollup["u:parent"]?.amount).toBeGreaterThan(0);
    expect(delta.rollup["u:parent"]?.sloc).toBe(10);
  });

  it("counts each unit's sloc once when a system root sits above the layers", () => {
    // Pins the totals across the single-root hierarchy Phase 1 introduced. `rollup` seeds its walk
    // from `parent === null`, so before the root policy layers were roots *and* reachable from the
    // system — a shape that would walk each subtree twice. Exact sloc is what makes that visible:
    // the system must report 10, the sum of its leaves, not 20.
    const system = makeUnit({
      id: "u:sys",
      qualname: "sys",
      kind: "system",
      parent: null,
      children: ["u:layer1", "u:layer2"],
      loc: { files: [], start: null, end: null, sloc: 0 },
    });
    const layer1 = makeUnit({
      id: "u:layer1",
      qualname: "layer1",
      kind: "layer",
      parent: "u:sys",
      children: ["u:child1"],
      loc: { files: [], start: null, end: null, sloc: 0 },
    });
    const layer2 = makeUnit({
      id: "u:layer2",
      qualname: "layer2",
      kind: "layer",
      parent: "u:sys",
      children: ["u:child2"],
      loc: { files: [], start: null, end: null, sloc: 0 },
    });
    const child1 = makeUnit({ id: "u:child1", qualname: "child1", parent: "u:layer1", loc: { files: ["a.py"], start: 1, end: 3, sloc: 3 } });
    const child2 = makeUnit({ id: "u:child2", qualname: "child2", parent: "u:layer2", loc: { files: ["b.py"], start: 1, end: 7, sloc: 7 } });

    const units = [system, layer1, layer2, child1, child2];
    const a = makeSnapshot(units.map((u) => ({ ...u, hash: { struct: "s1", text: "t1", semantic: null } })));
    const b = makeSnapshot(
      units.map((u) => (u.id === "u:child1" ? { ...u, hash: { struct: "s1", text: "t1-changed", semantic: null } } : { ...u, hash: { struct: "s1", text: "t1", semantic: null } })),
    );

    const delta = runDiffer(a, b);

    expect(delta.rollup["u:sys"]?.sloc).toBe(10);
    expect(delta.rollup["u:layer1"]?.sloc).toBe(3);
    expect(delta.rollup["u:layer2"]?.sloc).toBe(7);
    // Only child1 changed, so the system's sloc-weighted mean is child1's amount scaled by 3/10.
    // A leaf has no rollup entry of its own — the walk records only units with children — so the
    // contribution comes from its unit delta.
    const child1Amount = delta.unit_deltas.find((d) => d.unit === "u:child1")!.amount;
    expect(delta.rollup["u:sys"]?.amount).toBeCloseTo((child1Amount * 3) / 10, 3);
  });

  it("returns schema-required from/to snapshot refs and formulas provenance", () => {
    const a = makeSnapshot([], [], "aaa1111");
    const b = makeSnapshot([], [], "bbb2222");

    const delta = runDiffer(a, b);

    expect(delta.schema).toBe("scv-delta/1");
    expect(delta.from.sha).toBe("aaa1111");
    expect(delta.to.sha).toBe("bbb2222");
    expect(delta.provenance.formulas).toBeTruthy();
  });

  describe("risk_changed", () => {
    // A unit whose own bytes are untouched can still become riskier: more code now reaches it,
    // or it crossed into the public API. Both are visible only by comparing the two snapshots'
    // graphs, which is why `classify` — which sees just the two units — cannot decide this.
    it("emits risk_changed for an untouched unit whose blast radius grew", () => {
      const target = makeUnit({ id: "u:t", qualname: "src.t" });
      const caller = (n: string) => makeUnit({ id: `u:c${n}`, qualname: `src.c${n}` });
      const edge = (n: string): Edge => ({
        id: `e${n}`, from: `u:c${n}`, to: "u:t", kind: "calls", weight: 1, source: "static", confidence: 1,
      });

      const a = makeSnapshot([target, caller("1")], [edge("1")]);
      const b = makeSnapshot([target, caller("1"), caller("2")], [edge("1"), edge("2")]);

      const delta = runDiffer(a, b);
      const t = delta.unit_deltas.find((d) => d.unit === "u:t");

      expect(t).toMatchObject({ status: "risk_changed", fields: ["blast_radius"] });
      expect(t!.blast_radius.direct).toBe(2);
    });

    it("emits risk_changed when an untouched unit becomes public API", () => {
      const a = makeSnapshot([makeUnit({ id: "u:t", tags: [] })]);
      const b = makeSnapshot([makeUnit({ id: "u:t", tags: ["public-api"] })]);

      const delta = runDiffer(a, b);

      expect(delta.unit_deltas[0]).toMatchObject({
        unit: "u:t",
        status: "risk_changed",
        fields: ["blast_radius"],
      });
    });

    it("still omits a unit whose hashes and exposure are both unchanged", () => {
      const a = makeSnapshot([makeUnit({ id: "u:t" })]);
      const b = makeSnapshot([makeUnit({ id: "u:t" })]);

      expect(runDiffer(a, b).unit_deltas).toHaveLength(0);
    });

    it("does not downgrade a modified unit to risk_changed when its exposure also moved", () => {
      const a = makeSnapshot([makeUnit({ id: "u:t", tags: [], hash: { struct: "s1", text: "t1", semantic: null } })]);
      const b = makeSnapshot([makeUnit({ id: "u:t", tags: ["public-api"], hash: { struct: "s2", text: "t2", semantic: null } })]);

      expect(runDiffer(a, b).unit_deltas[0]).toMatchObject({ status: "modified" });
    });

    // A shrinking blast radius is still a change in exposure worth surfacing, but it must not
    // manufacture risk: the formula floor is driven by `amount`, which stays 0 here.
    it("reports zero amount and a zero risk floor for a risk_changed unit", () => {
      const a = makeSnapshot([makeUnit({ id: "u:t", tags: ["public-api"] })]);
      const b = makeSnapshot([makeUnit({ id: "u:t", tags: [] })]);

      const t = runDiffer(a, b).unit_deltas[0]!;

      expect(t.status).toBe("risk_changed");
      expect(t.amount).toBe(0);
      expect(t.risk.formula_floor).toBe(0);
    });
  });
});

describe("runDiffer — group lineage", () => {
  function makeGroup(id: string, members: string[]): Unit {
    return makeUnit({
      id,
      kind: "group",
      name: id,
      qualname: id,
      parent: "u:sys:orderly",
      children: [...members].sort(),
      hash: { struct: [...members].sort().join(","), text: null, semantic: id },
      provenance: { source: "llm", pass: "C" },
    });
  }

  it("attaches a split relationship to the predecessor and every successor", () => {
    const a = makeSnapshot([makeGroup("old", ["a", "b", "c", "d"])]);
    const b = makeSnapshot([makeGroup("n1", ["a", "b"]), makeGroup("n2", ["c", "d"])], [], "bbb2222");

    const byUnit = new Map(runDiffer(a, b).unit_deltas.map((d) => [d.unit, d]));

    expect(byUnit.get("old")).toMatchObject({
      status: "removed",
      relationship: { kind: "split", counterparts: ["n1", "n2"] },
    });
    expect(byUnit.get("n1")).toMatchObject({ status: "added", relationship: { kind: "split", counterparts: ["old"] } });
    expect(byUnit.get("n2")).toMatchObject({ status: "added", relationship: { kind: "split", counterparts: ["old"] } });
  });

  it("attaches a merged relationship when groups collapse into one", () => {
    const a = makeSnapshot([makeGroup("o1", ["a", "b"]), makeGroup("o2", ["c", "d"])]);
    const b = makeSnapshot([makeGroup("new", ["a", "b", "c", "d"])], [], "bbb2222");

    const byUnit = new Map(runDiffer(a, b).unit_deltas.map((d) => [d.unit, d]));

    expect(byUnit.get("new")?.relationship).toEqual({ kind: "merged", counterparts: ["o1", "o2"] });
    expect(byUnit.get("o1")?.relationship).toEqual({ kind: "merged", counterparts: ["new"] });
  });

  it("leaves relationship absent for a renamed group with unchanged membership", () => {
    // Same id and members, different name: `modified` from the semantic hash, and no lineage
    // event — the group did not move, it was relabeled.
    const a = makeSnapshot([makeGroup("g1", ["a", "b"])]);
    const b = makeSnapshot([{ ...makeGroup("g1", ["a", "b"]), name: "renamed", hash: { struct: "a,b", text: null, semantic: "renamed" } }], [], "bbb2222");

    const [delta] = runDiffer(a, b).unit_deltas;
    expect(delta?.status).toBe("modified");
    expect(delta?.relationship).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import type { Edge, Unit } from "@scv/schema";
import { rollUpEdges, applyEdgeBudget, DEFAULT_EDGE_BUDGET } from "../src/edge-budget.js";

function unit(id: string, kind: Unit["kind"], children: string[] = [], parent: string | null = null): Unit {
  return {
    id, kind, name: id, qualname: id, parent, children,
    loc: { files: [], sloc: 10 },
    tags: [], metrics: {},
    hash: { struct: null, text: null, semantic: null },
    provenance: { source: "static" },
  };
}

function edge(id: string, from: string, to: string, weight = 1, extra: Partial<Edge> = {}): Edge {
  return { id, from, to, kind: "calls", weight, source: "static", confidence: 1, ...extra };
}

/**
 * sys
 *  ├─ gA ─ lA ─ {a1, a2}
 *  └─ gB ─ lB ─ {b1, b2}
 */
const units = [
  unit("sys", "system", ["gA", "gB"]),
  unit("gA", "group", ["lA"], "sys"),
  unit("gB", "group", ["lB"], "sys"),
  unit("lA", "layer", ["a1", "a2"], "gA"),
  unit("lB", "layer", ["b1", "b2"], "gB"),
  unit("a1", "module", [], "lA"),
  unit("a2", "module", [], "lA"),
  unit("b1", "module", [], "lB"),
  unit("b2", "module", [], "lB"),
];
const unitsById = new Map(units.map((u) => [u.id, u]));
const visible = [unitsById.get("gA")!, unitsById.get("gB")!];

describe("rollUpEdges", () => {
  it("aggregates every contributor rather than keeping the first and dropping the rest", () => {
    // Three concrete leaf edges all roll up to the same gA->gB connector. The old behaviour
    // kept whichever came first and silently discarded the other two, so the connector
    // reported weight 1 for what is really 6 across 3 edges.
    const edges = [edge("e1", "a1", "b1", 1), edge("e2", "a2", "b2", 2), edge("e3", "a1", "b2", 3)];

    const rolled = rollUpEdges(edges, visible, unitsById);

    expect(rolled).toHaveLength(1);
    const [link] = rolled;
    expect(link!.from).toBe("gA");
    expect(link!.to).toBe("gB");
    expect(link!.weight).toBe(6);
    expect(link!.rollup).toBe(true);
    expect(link!.rollupProvenance).toEqual({ edges: ["e1", "e2", "e3"], count: 3, weight: 6 });
  });

  it("sorts contributor ids so the same input always yields the same provenance", () => {
    const forward = rollUpEdges([edge("e9", "a1", "b1"), edge("e1", "a2", "b2")], visible, unitsById);
    const reverse = rollUpEdges([edge("e1", "a2", "b2"), edge("e9", "a1", "b1")], visible, unitsById);

    expect(forward[0]!.rollupProvenance!.edges).toEqual(["e1", "e9"]);
    expect(reverse[0]!.rollupProvenance).toEqual(forward[0]!.rollupProvenance);
  });

  it("marks an edge already between two visible units as not a rollup", () => {
    const rolled = rollUpEdges([edge("e1", "gA", "gB")], visible, unitsById);

    expect(rolled[0]!.rollup).toBe(false);
    expect(rolled[0]!.rollupProvenance).toBeUndefined();
  });

  it("keeps an aggregate unresolved when any contributor is unresolved", () => {
    // An LLM-inferred edge is a claim, not an observation. Merging it into a static aggregate
    // must not launder it into one — a reader has to be able to see the connector is partly
    // inferred before trusting it.
    const edges = [edge("e1", "a1", "b1"), edge("e2", "a2", "b2", 1, { source: "llm", confidence: 0.4 })];

    const rolled = rollUpEdges(edges, visible, unitsById);

    expect(rolled[0]!.source).toBe("llm");
    expect(rolled[0]!.confidence).toBe(0.4);
  });

  it("drops an edge whose endpoints share one visible ancestor", () => {
    expect(rollUpEdges([edge("e1", "a1", "a2")], visible, unitsById)).toEqual([]);
  });
});

describe("applyEdgeBudget", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => edge(`e${i}`, `n${i}`, `t${i}`, 1));

  it("keeps every edge when the count is within budget", () => {
    const edges = many(5);
    const result = applyEdgeBudget(edges, 10);

    expect(result.edges).toEqual(edges);
    expect(result.elided).toBe(0);
  });

  it("keeps the heaviest edges and reports how many it dropped", () => {
    const edges = [edge("light", "a", "b", 1), edge("heavy", "c", "d", 9), edge("mid", "e", "f", 5)];

    const result = applyEdgeBudget(edges, 2);

    expect(result.edges.map((e) => e.id)).toEqual(["heavy", "mid"]);
    expect(result.elided).toBe(1);
  });

  it("ranks a cross-boundary edge above a heavier internal one", () => {
    // "Show cross-boundary edges first": coupling between two groups is the thing a reviewer
    // opened the view to find, and it is exactly what a naive weight sort buries under the
    // dense within-group traffic.
    const internal = edge("internal", "a1", "a2", 9);
    const crossing = edge("crossing", "a1", "b1", 1);

    const result = applyEdgeBudget([internal, crossing], 1, { unitsById });

    expect(result.edges.map((e) => e.id)).toEqual(["crossing"]);
  });

  it("breaks a full tie on id so the kept set never depends on input order", () => {
    const forward = applyEdgeBudget([edge("b", "x", "y", 1), edge("a", "p", "q", 1)], 1);
    const reverse = applyEdgeBudget([edge("a", "p", "q", 1), edge("b", "x", "y", 1)], 1);

    expect(forward.edges.map((e) => e.id)).toEqual(["a"]);
    expect(reverse.edges).toEqual(forward.edges);
  });

  it("prefers an aggregate standing for more concrete edges when weights tie", () => {
    const single = edge("single", "a", "b", 4);
    const bundle = edge("bundle", "c", "d", 4, {
      rollup: true,
      rollupProvenance: { edges: ["x", "y", "z"], count: 3, weight: 4 },
    });

    const result = applyEdgeBudget([single, bundle], 1);

    expect(result.edges.map((e) => e.id)).toEqual(["bundle"]);
  });

  it("exposes a default budget rather than leaving each caller to invent one", () => {
    expect(DEFAULT_EDGE_BUDGET).toBeGreaterThan(0);
  });

  // The ranking is what makes the kept set independent of arrival order, so a set that fits
  // under the budget must not skip it. Otherwise the drawing order — and every lane index
  // routed from it — flips when the input happens to arrive differently, which is exactly the
  // instability the total order exists to prevent.
  it("orders an under-budget set too, so arrival order never reaches the output", () => {
    const edges = [edge("c", "a1", "b1", 1), edge("a", "a2", "b2", 5), edge("b", "b1", "b2", 5)];

    const forward = applyEdgeBudget(edges, 10, { unitsById });
    const reverse = applyEdgeBudget([...edges].reverse(), 10, { unitsById });

    expect(forward.elided).toBe(0);
    expect(reverse.edges.map((e) => e.id)).toEqual(forward.edges.map((e) => e.id));
    // Cross-boundary first, then weight — not the order they were handed over.
    expect(forward.edges.map((e) => e.id)).toEqual(["a", "c", "b"]);
  });
});

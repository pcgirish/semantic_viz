import { describe, expect, it, vi } from "vitest";
import { runDifferWithRisk } from "../src/diff-with-risk.js";
import type { Provider, ProviderResult } from "@scv/interpreter";
import type { Snapshot, Unit, Edge } from "@scv/schema";

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: "u:py:src.a#f",
    kind: "module",
    name: "a",
    qualname: "src.a",
    lang: "python",
    parent: null,
    children: [],
    loc: { files: ["src/a.py"], start: 1, end: 5, sloc: 4 },
    signature: null,
    semantics: { what: "does a", how: "", when: "", where: "", why: "", confidence: 0.9, source: "llm" },
    cost: null,
    tags: [],
    metrics: {},
    authors: [],
    hash: { struct: "s1", text: "t1", semantic: "sem1" },
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

function providerReturning(byUnit: Record<string, object>, rankOrder: number[]): Provider {
  return {
    name: "fake",
    model: "fake-model",
    interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
      if (prompt.includes("ranking a list")) {
        return { text: JSON.stringify({ ranked: rankOrder }), tokens: 10 };
      }
      const hit = Object.keys(byUnit).find((qualname) => prompt.includes(qualname));
      return { text: JSON.stringify(hit ? byUnit[hit] : {}), tokens: 10 };
    }),
  };
}

describe("runDifferWithRisk", () => {
  it("overrides the formula-floor risk with Pass D's LLM risk for a newly added unit", async () => {
    const a = makeSnapshot([]);
    const b = makeSnapshot([makeUnit()]);
    const provider = providerReturning(
      {
        "src.a": {
          axes: { functionality: 0.2, availability: 0.9, scalability: 0.1, performance: 0.1, security: 0.3 },
          why: "no fallback",
          confidence: 0.7,
        },
      },
      [1],
    );

    const delta = await runDifferWithRisk(a, b, provider, "p1");

    expect(delta.unit_deltas[0]?.risk.source).toBe("llm");
    expect(delta.unit_deltas[0]?.risk.score).toBe(0.9);
    expect(delta.unit_deltas[0]?.risk.formula_floor).toBeDefined();
  });

  it("keeps the deterministic formula floor when Pass D returns a lower score", async () => {
    const a = makeSnapshot([]);
    const b = makeSnapshot([makeUnit()]);
    // All axes low, so Pass D's max-axis score lands below the formula floor for an added unit.
    const provider = providerReturning(
      {
        "src.a": {
          axes: { functionality: 0.01, availability: 0.01, scalability: 0.01, performance: 0.01, security: 0.01 },
          why: "trivial",
          confidence: 0.9,
        },
      },
      [1],
    );

    const delta = await runDifferWithRisk(a, b, provider, "p1");
    const risk = delta.unit_deltas[0]?.risk;

    // design.md:189 — the Interpreter "may raise the score above the floor", never lower it.
    expect(risk?.formula_floor).toBeGreaterThan(0.01);
    expect(risk?.score).toBe(risk?.formula_floor);
  });

  it("populates inspect_queue in ranked order with rank numbers", async () => {
    const a = makeSnapshot([]);
    const unit1 = makeUnit({ id: "u:1", qualname: "n1" });
    const unit2 = makeUnit({ id: "u:2", qualname: "n2" });
    const b = makeSnapshot([unit1, unit2]);
    const provider = providerReturning(
      {
        n1: { axes: { functionality: 0.6, availability: 0.6, scalability: 0.1, performance: 0.1, security: 0.1 }, why: "w1", confidence: 0.8 },
        n2: { axes: { functionality: 0.2, availability: 0.2, scalability: 0.2, performance: 0.2, security: 0.2 }, why: "w2", confidence: 0.5 },
      },
      [2, 1],
    );

    const delta = await runDifferWithRisk(a, b, provider, "p1");

    expect(delta.inspect_queue.map((q) => q.unit)).toEqual(["u:2", "u:1"]);
    expect(delta.inspect_queue[0]).toMatchObject({ rank: 1, unit: "u:2" });
    expect(delta.inspect_queue[1]).toMatchObject({ rank: 2, unit: "u:1" });
  });

  it("does not call Pass D for units that did not change at all", async () => {
    const unit = makeUnit({ hash: { struct: "s1", text: "t1", semantic: "sem1" } });
    const a = makeSnapshot([unit]);
    const b = makeSnapshot([unit]);
    const provider = providerReturning({}, []);

    const delta = await runDifferWithRisk(a, b, provider, "p1");

    expect(delta.unit_deltas).toEqual([]);
    expect(delta.inspect_queue).toEqual([]);
  });

  it("narrates a module whose text changed but whose (unmodeled) module-level semantic hash did not — e.g. a reformat or config tuning", async () => {
    const unit = makeUnit({ hash: { struct: "s1", text: "t1-changed", semantic: null } });
    const a = makeSnapshot([{ ...unit, hash: { struct: "s1", text: "t1", semantic: null } }]);
    const b = makeSnapshot([unit]);
    const provider = providerReturning(
      { "src.a": { axes: { functionality: 0.1, availability: 0.1, scalability: 0.1, performance: 0.1, security: 0.1 }, why: "reformat", confidence: 0.4 } },
      [1],
    );

    const delta = await runDifferWithRisk(a, b, provider, "p1");

    expect(delta.unit_deltas[0]?.risk.source).toBe("llm");
    expect(delta.inspect_queue).toHaveLength(1);
  });

  it("never narrates or ranks layer/system units — clustering churn is not a code-level risk", async () => {
    const layer = makeUnit({ id: "u:layer:x", kind: "layer", qualname: "ops", children: [] });
    const system = makeUnit({ id: "u:sys:orderly", kind: "system", qualname: "orderly", children: [] });
    const a = makeSnapshot([]);
    const b = makeSnapshot([layer, system]);
    const provider = providerReturning({}, []);

    const delta = await runDifferWithRisk(a, b, provider, "p1");

    expect(delta.unit_deltas.every((d) => d.risk.source === "formula")).toBe(true);
    expect(delta.inspect_queue).toEqual([]);
    expect(provider.interpret).not.toHaveBeenCalled();
  });

  it("never narrates or ranks function/class units — the inspect queue surfaces module-level risk only", async () => {
    const fn = makeUnit({ id: "u:fn:x", kind: "function", qualname: "src.a.f", children: [] });
    const cls = makeUnit({ id: "u:cls:y", kind: "class", qualname: "src.a.C", children: [] });
    const a = makeSnapshot([]);
    const b = makeSnapshot([fn, cls]);
    const provider = providerReturning({}, []);

    const delta = await runDifferWithRisk(a, b, provider, "p1");

    expect(delta.unit_deltas.every((d) => d.risk.source === "formula")).toBe(true);
    expect(delta.inspect_queue).toEqual([]);
    expect(provider.interpret).not.toHaveBeenCalled();
  });
});

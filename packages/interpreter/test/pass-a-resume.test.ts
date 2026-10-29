import { describe, expect, it, vi } from "vitest";
import type { Snapshot, Unit } from "@semviz/schema";
import type { SymbolGraph, SymbolUnit } from "@semviz/extractor";
import { runFunctionsPass } from "../src/orchestrate.js";
import type { PassAUnitRecord } from "../src/cache.js";
import type { Provider, ProviderResult } from "../src/provider.js";

function symbolUnit(id: string, name: string): SymbolUnit {
  return {
    id,
    kind: "function",
    name,
    qualname: `mod.${name}`,
    lang: "python",
    parent: null,
    children: [],
    loc: { file: "mod.py", start: 1, end: 5 },
    sloc: 5,
    params: [],
    returns: null,
    bases: [],
    hash: { struct: `struct-${name}`, text: `text-${name}` },
    metrics: { fanIn: 0, fanOut: 0, churn: 0, commits: 0 },
    authors: [],
  };
}

function snapshotUnit(id: string, name: string): Unit {
  return {
    id,
    kind: "function",
    name,
    qualname: `mod.${name}`,
    lang: "python",
    parent: null,
    children: [],
    loc: { files: ["mod.py"], start: 1, end: 5, sloc: 5 },
    signature: null,
    semantics: null,
    cost: null,
    tags: [],
    metrics: {},
    hash: { struct: `struct-${name}`, text: `text-${name}`, semantic: null },
    provenance: { source: "static", pass: null, provider: null, model: null },
  } as Unit;
}

function makeSnapshot(units: Unit[]): Snapshot {
  return {
    schema: "scv/1",
    snapshot_id: "snap",
    repo: { root: "/repo", vcs: "git" },
    rev: { sha: "sha1", branch: "main", dirty: false },
    provenance: { tool: "scv", version: "0", generatedAt: "2026-01-01T00:00:00Z" },
    units,
    edges: [],
    externals: [],
  } as unknown as Snapshot;
}

function makeGraph(units: SymbolUnit[]): SymbolGraph {
  return { units, edges: [], externals: [], blockGraph: {}, routes: [] };
}

const PASS_A_RESPONSE = JSON.stringify({
  what: "does a thing",
  how: "by doing it",
  when: "on request",
  where: "mod.py",
  why: "because",
  confidence: 0.9,
  ports: { in: [], out: [] },
  cost: { complexity: 1, io: [], estimate: "O(1)", confidence: 0.9 },
  tags: [],
});

/** Succeeds for every unit except those named in `failFor`, which throw on every attempt. */
function providerFailingFor(failFor: Set<string>): Provider {
  return {
    name: "fake",
    model: "fake-model",
    interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
      for (const name of failFor) {
        if (prompt.includes(`mod.${name}`)) throw new Error(`boom for ${name}`);
      }
      return { text: PASS_A_RESPONSE, tokens: 10 };
    }),
  };
}

function baseOptions(units: { id: string; name: string }[]) {
  return {
    snapshot: makeSnapshot(units.map((u) => snapshotUnit(u.id, u.name))),
    graph: makeGraph(units.map((u) => symbolUnit(u.id, u.name))),
    promptRev: "p1",
    readSource: () => "def f(): pass",
    reportProgress: () => {},
  };
}

describe("runFunctionsPass resume contract", () => {
  // Test 7 — a failure must be reported, must not be seeded as done, and must be retried.
  it("reports a failed unit via onUnitComplete and returns failedCount with attemptedAll", async () => {
    const seen: { id: string; status: string }[] = [];
    const result = await runFunctionsPass({
      ...baseOptions([{ id: "u:a", name: "alpha" }, { id: "u:b", name: "beta" }]),
      provider: providerFailingFor(new Set(["beta"])),
      onUnitComplete: (id, _unit, status) => seen.push({ id, status }),
    });

    expect(seen).toEqual(
      expect.arrayContaining([
        { id: "u:a", status: "ok" },
        { id: "u:b", status: "failed" },
      ]),
    );
    expect(result.failedCount).toBe(1);
    expect(result.attemptedAll).toBe(true);
  });

  it("does not seed a failed prior record, so the unit is re-attempted", async () => {
    const prior = new Map<string, PassAUnitRecord>([
      ["u:a", { unit: snapshotUnit("u:a", "alpha"), status: "failed" }],
    ]);
    const provider = providerFailingFor(new Set());

    const result = await runFunctionsPass({
      ...baseOptions([{ id: "u:a", name: "alpha" }]),
      provider,
      priorResults: prior,
    });

    expect(provider.interpret).toHaveBeenCalledTimes(1);
    expect(result.failedCount).toBe(0);
    expect(result.units.find((u) => u.id === "u:a")?.semantics?.what).toBe("does a thing");
  });

  it("skips a unit whose prior record is ok, without calling the provider", async () => {
    const done: Unit = {
      ...snapshotUnit("u:a", "alpha"),
      semantics: {
        what: "restored one-liner",
        how: "h",
        when: "w",
        where: "mod.py",
        why: "y",
        confidence: 0.9,
        source: "llm",
      },
      hash: { struct: "struct-alpha", text: "text-alpha", semantic: "sem-a" },
    } as Unit;
    const provider = providerFailingFor(new Set());

    const result = await runFunctionsPass({
      ...baseOptions([{ id: "u:a", name: "alpha" }]),
      provider,
      priorResults: new Map([["u:a", { unit: done, status: "ok" } as PassAUnitRecord]]),
    });

    expect(provider.interpret).not.toHaveBeenCalled();
    expect(result.units.find((u) => u.id === "u:a")?.semantics?.what).toBe("restored one-liner");
    expect(result.failedCount).toBe(0);
    expect(result.attemptedAll).toBe(true);
  });

  it("restricts the pass to scopedLeafIds and reports attemptedAll: false", async () => {
    const provider = providerFailingFor(new Set());

    const result = await runFunctionsPass({
      ...baseOptions([{ id: "u:a", name: "alpha" }, { id: "u:b", name: "beta" }]),
      provider,
      scopedLeafIds: new Set(["u:a"]),
    });

    expect(provider.interpret).toHaveBeenCalledTimes(1);
    expect(result.attemptedAll).toBe(false);
    expect(result.units.find((u) => u.id === "u:a")?.semantics).not.toBeNull();
    expect(result.units.find((u) => u.id === "u:b")?.semantics).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";
import { runFlowsPass } from "../src/orchestrate.js";
import type { Provider, ProviderResult } from "../src/provider.js";
import type { SymbolGraph } from "@semviz/extractor";
import type { Snapshot } from "@semviz/schema";

function makeGraph(): SymbolGraph {
  return {
    units: [
      {
        id: "u:py:src.api.create_order#f",
        kind: "function",
        name: "create_order",
        qualname: "src.api.create_order",
        lang: "python",
        parent: null,
        children: [],
        loc: { file: "src/api.py", start: 1, end: 5 },
        sloc: 4,
        params: [],
        returns: null,
        bases: [],
        hash: { struct: "s1", text: "t1" },
        metrics: { fanIn: 0, fanOut: 1, churn: 0, commits: 1 },
        authors: [],
      },
      {
        id: "u:py:src.orders.persist#f",
        kind: "function",
        name: "persist",
        qualname: "src.orders.persist",
        lang: "python",
        parent: null,
        children: [],
        loc: { file: "src/orders.py", start: 1, end: 5 },
        sloc: 4,
        params: [],
        returns: null,
        bases: [],
        hash: { struct: "s2", text: "t2" },
        metrics: { fanIn: 1, fanOut: 0, churn: 0, commits: 1 },
        authors: [],
      },
    ],
    edges: [
      {
        id: "e:1",
        from: "u:py:src.api.create_order#f",
        to: "u:py:src.orders.persist#f",
        kind: "calls",
        confidence: 1,
        evidence: { file: "src/api.py", line: 3 },
      },
    ],
    externals: [],
    blockGraph: {},
    routes: [{ unit: "u:py:src.api.create_order#f", method: "post", path: "/orders" }],
  };
}

function makeSnapshot(graph: SymbolGraph): Snapshot {
  return {
    schema: "scv/1",
    snapshot_id: "snap1",
    repo: { root: "orderly", vcs: "git" },
    rev: { sha: "abc1234", kind: "commit", author: "a", author_kind: "human", ts: "2026-01-01T00:00:00Z" },
    provenance: { extractor: "scv-ts/0.1.0", interpreter: { model: "none", prompt_rev: "none" } },
    units: graph.units.map((u) => ({
      id: u.id,
      kind: u.kind,
      name: u.name,
      qualname: u.qualname,
      lang: u.lang,
      parent: u.parent,
      children: u.children,
      loc: { files: [u.loc.file], start: u.loc.start, end: u.loc.end, sloc: u.sloc },
      signature: null,
      semantics: { what: "Creates an order.", how: "", when: "", where: "", why: "", confidence: 0.9, source: "llm" as const },
      cost: null,
      tags: [],
      metrics: { fan_in: u.metrics.fanIn, fan_out: u.metrics.fanOut, churn: u.metrics.churn, commits: u.metrics.commits },
      authors: u.authors,
      hash: { struct: u.hash.struct, text: u.hash.text, semantic: null },
      provenance: { source: "static" as const },
    })),
    edges: graph.edges.map((e) => ({
      id: e.id,
      from: e.from,
      to: e.to,
      kind: e.kind,
      weight: 1,
      evidence: [e.evidence],
      source: "static" as const,
      confidence: e.confidence,
    })),
    externals: [],
  };
}

function fakeProvider(responses: object[]): Provider {
  let call = 0;
  return {
    name: "fake",
    model: "fake-model",
    interpret: vi.fn(async (): Promise<ProviderResult> => ({ text: JSON.stringify(responses[call++]), tokens: 10 })),
  };
}

describe("runFlowsPass route hints", () => {
  it("includes a structurally-detected route handler as an entry point even when the LLM's response omits it", async () => {
    const graph = makeGraph();
    const snapshot = makeSnapshot(graph);
    const provider = fakeProvider([
      { flows: [] },
      {
        what: "Creates an order.",
        how: "Handles the request.",
        when: "On POST.",
        where: "src/api.",
        why: "Entry point.",
        tags: [],
        confidence: 0.9,
      },
    ]);

    const flowUnits = await runFlowsPass({
      snapshot,
      graph,
      units: snapshot.units,
      provider,
      promptRev: "p1",
      reportProgress: () => {},
    });

    expect(flowUnits).toHaveLength(1);
    expect(flowUnits[0]?.route).toBe("POST /orders");
  });
});

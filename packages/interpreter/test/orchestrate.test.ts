import { describe, expect, it, vi } from "vitest";
import { runInterpreter } from "../src/orchestrate.js";
import type { Provider, ProviderResult } from "../src/provider.js";
import type { SymbolGraph } from "@scv/extractor";
import type { Snapshot } from "@scv/schema";

function makeGraph(): SymbolGraph {
  return {
    units: [
      {
        id: "u:py:src.admin_tasks#m",
        kind: "module",
        name: "admin_tasks",
        qualname: "src.admin_tasks",
        lang: "python",
        parent: null,
        children: ["u:py:src.admin_tasks.run#f"],
        loc: { file: "src/admin_tasks.py", start: 1, end: 10 },
        sloc: 8,
        params: [],
        returns: null,
        bases: [],
        hash: { struct: "s-mod", text: "t-mod" },
        metrics: { fanIn: 0, fanOut: 1, churn: 0, commits: 1 },
        authors: [],
      },
      {
        id: "u:py:src.admin_tasks.run#f",
        kind: "function",
        name: "run",
        qualname: "src.admin_tasks.run",
        lang: "python",
        parent: "u:py:src.admin_tasks#m",
        children: [],
        loc: { file: "src/admin_tasks.py", start: 3, end: 8 },
        sloc: 5,
        params: [],
        returns: null,
        bases: [],
        hash: { struct: "s1", text: "t1" },
        metrics: { fanIn: 0, fanOut: 1, churn: 0, commits: 1 },
        authors: [],
      },
      {
        id: "u:py:scripts.backfill#m",
        kind: "module",
        name: "backfill",
        qualname: "scripts.backfill",
        lang: "python",
        parent: null,
        children: ["u:py:scripts.backfill.run#f"],
        loc: { file: "scripts/backfill.py", start: 1, end: 10 },
        sloc: 6,
        params: [],
        returns: null,
        bases: [],
        hash: { struct: "s-mod2", text: "t-mod2" },
        metrics: { fanIn: 1, fanOut: 0, churn: 0, commits: 1 },
        authors: [],
      },
      {
        id: "u:py:scripts.backfill.run#f",
        kind: "function",
        name: "run",
        qualname: "scripts.backfill.run",
        lang: "python",
        parent: "u:py:scripts.backfill#m",
        children: [],
        loc: { file: "scripts/backfill.py", start: 3, end: 8 },
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
        from: "u:py:src.admin_tasks.run#f",
        to: "u:py:scripts.backfill.run#f",
        kind: "calls",
        confidence: 1,
        evidence: { file: "src/admin_tasks.py", line: 4 },
      },
    ],
    externals: [],
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
      semantics: null,
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

function fakeProvider(responses: Record<string, object> | object[]): Provider {
  let call = 0;
  const seq = Array.isArray(responses) ? responses : null;
  return {
    name: "fake",
    model: "fake-model",
    interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
      if (seq) return { text: JSON.stringify(seq[call++]), tokens: 10 };
      const key = Object.keys(responses as Record<string, object>).find((k) => prompt.includes(k));
      return { text: JSON.stringify(key ? (responses as Record<string, object>)[key] : {}), tokens: 10 };
    }),
  };
}

const passAResponse = {
  what: "does a thing",
  how: "by doing it",
  when: "on call",
  where: "backend",
  why: "needed",
  confidence: 0.9,
  ports: { in: [], out: [] },
  cost: { complexity: 1, io: [], estimate: "fast", confidence: 0.9 },
  tags: [],
};

describe("runInterpreter", () => {
  it("attaches Pass A semantics to every leaf unit", async () => {
    const graph = makeGraph();
    const snapshot = makeSnapshot(graph);
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
        if (prompt.includes("grouping the files")) {
          return {
            text: JSON.stringify({ clusters: { ops: ["src/admin_tasks.py", "scripts/backfill.py"] } }),
            tokens: 10,
          };
        }
        if (prompt.includes("describing why")) {
          return { text: JSON.stringify({ what: "ops what", how: "ops how", when: "ops when", where: "ops where", why: "ops layer", confidence: 0.8 }), tokens: 10 };
        }
        return { text: JSON.stringify(passAResponse), tokens: 10 };
      }),
    };

    const result = await runInterpreter({
      snapshot,
      graph,
      provider,
      promptRev: "p1",
      readSource: () => "def run(): ...",
    });

    const run = result.units.find((u) => u.id === "u:py:src.admin_tasks.run#f");
    expect(run?.semantics?.what).toBe("does a thing");
    expect(run?.hash.semantic).toBeTruthy();
  });

  it("adds a system unit and layer units from Pass B/C, grouping admin_tasks with scripts", async () => {
    const graph = makeGraph();
    const snapshot = makeSnapshot(graph);
    const provider = fakeProvider({
      "grouping the files": { clusters: { ops: ["src/admin_tasks.py", "scripts/backfill.py"] } },
      "describing why": { what: "ops what", how: "ops how", when: "ops when", where: "ops where", why: "operational scripts", confidence: 0.8 },
    });
    // module units get Pass A too; fall through to passAResponse for anything else
    const wrapped: Provider = {
      name: provider.name,
      model: provider.model,
      interpret: async (prompt: string) => {
        if (prompt.includes("grouping the files")) return provider.interpret(prompt);
        if (prompt.includes("describing why")) return provider.interpret(prompt);
        return { text: JSON.stringify(passAResponse), tokens: 10 };
      },
    };

    const result = await runInterpreter({
      snapshot,
      graph,
      provider: wrapped,
      promptRev: "p1",
      readSource: () => "def run(): ...",
    });

    const system = result.units.find((u) => u.kind === "system");
    expect(system).toBeTruthy();
    const layer = result.units.find((u) => u.kind === "layer" && u.qualname === "ops");
    expect(layer).toBeTruthy();
    const opsFiles = result.units.filter((u) => u.parent === layer?.id).map((u) => u.qualname);
    expect(opsFiles.sort()).toEqual(["scripts.backfill", "src.admin_tasks"]);
  });

  it("gives a layer with the same file membership the same id across runs, even when the LLM names the cluster differently — layer identity must not depend on the LLM's naming choice, or every re-run looks like the layer was removed and re-added", async () => {
    const graph = makeGraph();
    const snapshotA = makeSnapshot(graph);
    const snapshotB = makeSnapshot(graph);

    const providerFor = (clusterName: string, layerName: string): Provider => ({
      name: "fake",
      model: "fake-model",
      interpret: async (prompt: string) => {
        if (prompt.includes("grouping the files")) {
          return {
            text: JSON.stringify({ clusters: { [clusterName]: ["src/admin_tasks.py", "scripts/backfill.py"] } }),
            tokens: 10,
          };
        }
        if (prompt.includes("describing why")) {
          return { text: JSON.stringify({ what: `${layerName} what`, how: `${layerName} how`, when: `${layerName} when`, where: `${layerName} where`, why: `${layerName} layer`, confidence: 0.8 }), tokens: 10 };
        }
        return { text: JSON.stringify(passAResponse), tokens: 10 };
      },
    });

    const resultA = await runInterpreter({
      snapshot: snapshotA,
      graph,
      provider: providerFor("ops", "ops"),
      promptRev: "p1",
      readSource: () => "def run(): ...",
    });
    const resultB = await runInterpreter({
      snapshot: snapshotB,
      graph,
      provider: providerFor("operational-scripts", "operational-scripts"),
      promptRev: "p1",
      readSource: () => "def run(): ...",
    });

    const layerA = resultA.units.find((u) => u.kind === "layer");
    const layerB = resultB.units.find((u) => u.kind === "layer");
    expect(layerA?.id).toBe(layerB?.id);
  });

  it("does not fail the whole run when Pass A returns unparseable output for one leaf unit — that unit is left without semantics, other units still get theirs", async () => {
    const graph = makeGraph();
    const snapshot = makeSnapshot(graph);
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
        if (prompt.includes("grouping the files")) {
          return {
            text: JSON.stringify({ clusters: { ops: ["src/admin_tasks.py", "scripts/backfill.py"] } }),
            tokens: 10,
          };
        }
        if (prompt.includes("describing why")) {
          return { text: JSON.stringify({ what: "ops what", how: "ops how", when: "ops when", where: "ops where", why: "ops layer", confidence: 0.8 }), tokens: 10 };
        }
        if (prompt.includes("scripts.backfill.run")) {
          return { text: "not json at all", tokens: 10 };
        }
        return { text: JSON.stringify(passAResponse), tokens: 10 };
      }),
    };

    const result = await runInterpreter({
      snapshot,
      graph,
      provider,
      promptRev: "p1",
      readSource: () => "def run(): ...",
    });

    const broken = result.units.find((u) => u.id === "u:py:scripts.backfill.run#f");
    expect(broken?.semantics).toBeNull();

    const ok = result.units.find((u) => u.id === "u:py:src.admin_tasks.run#f");
    expect(ok?.semantics?.what).toBe("does a thing");
  });

  it("never runs more than 2 Pass A calls concurrently, so a local Ollama instance isn't flooded", async () => {
    const leafCount = 6;
    const units: SymbolGraph["units"] = Array.from({ length: leafCount }, (_, i) => ({
      id: `u:py:mod${i}.run#f`,
      kind: "function",
      name: "run",
      qualname: `mod${i}.run`,
      lang: "python",
      parent: null,
      children: [],
      loc: { file: `mod${i}.py`, start: 1, end: 5 },
      sloc: 4,
      params: [],
      returns: null,
      bases: [],
      hash: { struct: `s${i}`, text: `t${i}` },
      metrics: { fanIn: 0, fanOut: 0, churn: 0, commits: 1 },
      authors: [],
    }));
    const graph: SymbolGraph = { units, edges: [], externals: [] };
    const snapshot = makeSnapshot(graph);

    let inFlight = 0;
    let maxInFlight = 0;
    let passACalls = 0;
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
        if (prompt.includes("grouping the files")) {
          return { text: JSON.stringify({ clusters: {} }), tokens: 10 };
        }
        passACalls++;
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return { text: JSON.stringify(passAResponse), tokens: 10 };
      }),
    };

    await runInterpreter({ snapshot, graph, provider, promptRev: "p1", readSource: () => "def run(): ..." });

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(passACalls).toBe(leafCount);
  });
});

import { describe, expect, it, vi } from "vitest";
import { runInterpreter } from "../src/orchestrate.js";
import type { Provider, ProviderContext, ProviderResult } from "../src/provider.js";
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
    blockGraph: {},
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
        if (prompt.includes("grouping a codebase's architectural layers")) {
          return { text: JSON.stringify({ groups: { platform: ["ops"] } }), tokens: 10 };
        }
        if (prompt.includes("identifying api_flow")) {
          return { text: JSON.stringify({ flows: [] }), tokens: 10 };
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

  it("sets a leaf unit's signature from Pass A's ports output, not left null", async () => {
    const graph = makeGraph();
    const snapshot = makeSnapshot(graph);
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
        if (prompt.includes("grouping the files")) return { text: JSON.stringify({ clusters: {} }), tokens: 10 };
        if (prompt.includes("grouping a codebase's architectural layers")) return { text: JSON.stringify({ groups: {} }), tokens: 10 };
        if (prompt.includes("identifying api_flow")) return { text: JSON.stringify({ flows: [] }), tokens: 10 };
        return { text: JSON.stringify(passAResponse), tokens: 10 };
      }),
    };

    const result = await runInterpreter({ snapshot, graph, provider, promptRev: "p1", readSource: () => "def run(): ..." });

    const run = result.units.find((u) => u.id === "u:py:src.admin_tasks.run#f");
    expect(run?.signature).toEqual({ in: [], out: [], raises: [], async: false });
  });

  it("derives each file's oneLiner from its leaf units' semantics, not the module unit (which never gets Pass A semantics)", async () => {
    const graph = makeGraph();
    const snapshot = makeSnapshot(graph);
    let passBPrompt = "";
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
        if (prompt.includes("grouping the files")) {
          passBPrompt = prompt;
          return { text: JSON.stringify({ clusters: {} }), tokens: 10 };
        }
        if (prompt.includes("grouping a codebase's architectural layers")) {
          return { text: JSON.stringify({ groups: {} }), tokens: 10 };
        }
        if (prompt.includes("identifying api_flow")) {
          return { text: JSON.stringify({ flows: [] }), tokens: 10 };
        }
        return { text: JSON.stringify(passAResponse), tokens: 10 };
      }),
    };

    await runInterpreter({ snapshot, graph, provider, promptRev: "p1", readSource: () => "def run(): ..." });

    expect(passBPrompt).not.toContain("(no summary)");
    expect(passBPrompt).toContain("does a thing");
  });

  it("passes each leaf unit's static callers/callees (qualnames) into its Pass A prompt", async () => {
    const graph = makeGraph();
    const snapshot = makeSnapshot(graph);
    const prompts: string[] = [];
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
        if (prompt.includes("grouping the files")) return { text: JSON.stringify({ clusters: {} }), tokens: 10 };
        if (prompt.includes("grouping a codebase's architectural layers")) return { text: JSON.stringify({ groups: {} }), tokens: 10 };
        if (prompt.includes("identifying api_flow")) return { text: JSON.stringify({ flows: [] }), tokens: 10 };
        prompts.push(prompt);
        return { text: JSON.stringify(passAResponse), tokens: 10 };
      }),
    };

    await runInterpreter({ snapshot, graph, provider, promptRev: "p1", readSource: () => "def run(): ..." });

    // edge: admin_tasks.run -> backfill.run
    const callerPrompt = prompts.find((p) => p.includes("Unit: src.admin_tasks.run"));
    expect(callerPrompt).toContain("Callees:");
    expect(callerPrompt).toContain("scripts.backfill.run");

    const calleePrompt = prompts.find((p) => p.includes("Unit: scripts.backfill.run"));
    expect(calleePrompt).toContain("Callers:");
    // Callee ran first (bottom-up order); its one-liner should be inlined in the caller's
    // Callees: line for free, no extra call.
    expect(callerPrompt).toContain("scripts.backfill.run — does a thing");
    expect(calleePrompt).toContain("src.admin_tasks.run");
  });

  it("processes Pass A bottom-up over the call graph — callees before callers — for a chain a -> b -> c", async () => {
    const graph: SymbolGraph = {
      units: [
        {
          id: "u:py:a#f",
          kind: "function",
          name: "a",
          qualname: "mod.a",
          lang: "python",
          parent: null,
          children: [],
          loc: { file: "mod.py", start: 1, end: 3 },
          sloc: 2,
          params: [],
          returns: null,
          bases: [],
          hash: { struct: "sa", text: "ta" },
          metrics: { fanIn: 0, fanOut: 1, churn: 0, commits: 1 },
          authors: [],
        },
        {
          id: "u:py:b#f",
          kind: "function",
          name: "b",
          qualname: "mod.b",
          lang: "python",
          parent: null,
          children: [],
          loc: { file: "mod.py", start: 5, end: 7 },
          sloc: 2,
          params: [],
          returns: null,
          bases: [],
          hash: { struct: "sb", text: "tb" },
          metrics: { fanIn: 1, fanOut: 1, churn: 0, commits: 1 },
          authors: [],
        },
        {
          id: "u:py:c#f",
          kind: "function",
          name: "c",
          qualname: "mod.c",
          lang: "python",
          parent: null,
          children: [],
          loc: { file: "mod.py", start: 9, end: 11 },
          sloc: 2,
          params: [],
          returns: null,
          bases: [],
          hash: { struct: "sc", text: "tc" },
          metrics: { fanIn: 1, fanOut: 0, churn: 0, commits: 1 },
          authors: [],
        },
      ],
      edges: [
        { id: "e:ab", from: "u:py:a#f", to: "u:py:b#f", kind: "calls", confidence: 1, evidence: { file: "mod.py", line: 1 } },
        { id: "e:bc", from: "u:py:b#f", to: "u:py:c#f", kind: "calls", confidence: 1, evidence: { file: "mod.py", line: 5 } },
      ],
      externals: [],
      blockGraph: {},
    };
    const snapshot = makeSnapshot(graph);
    const order: string[] = [];
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
        if (prompt.includes("grouping the files")) return { text: JSON.stringify({ clusters: {} }), tokens: 10 };
        if (prompt.includes("grouping a codebase's architectural layers")) return { text: JSON.stringify({ groups: {} }), tokens: 10 };
        if (prompt.includes("identifying api_flow")) return { text: JSON.stringify({ flows: [] }), tokens: 10 };
        if (prompt.includes("Unit: mod.a")) order.push("a");
        if (prompt.includes("Unit: mod.b")) order.push("b");
        if (prompt.includes("Unit: mod.c")) order.push("c");
        return { text: JSON.stringify(passAResponse), tokens: 10 };
      }),
    };

    await runInterpreter({ snapshot, graph, provider, promptRev: "p1", readSource: () => "def f(): ..." });

    expect(order).toEqual(["c", "b", "a"]);
  });

  it("completes analysis on a call cycle a -> b -> a without hanging", async () => {
    const graph: SymbolGraph = {
      units: [
        {
          id: "u:py:a#f",
          kind: "function",
          name: "a",
          qualname: "mod.a",
          lang: "python",
          parent: null,
          children: [],
          loc: { file: "mod.py", start: 1, end: 3 },
          sloc: 2,
          params: [],
          returns: null,
          bases: [],
          hash: { struct: "sa", text: "ta" },
          metrics: { fanIn: 1, fanOut: 1, churn: 0, commits: 1 },
          authors: [],
        },
        {
          id: "u:py:b#f",
          kind: "function",
          name: "b",
          qualname: "mod.b",
          lang: "python",
          parent: null,
          children: [],
          loc: { file: "mod.py", start: 5, end: 7 },
          sloc: 2,
          params: [],
          returns: null,
          bases: [],
          hash: { struct: "sb", text: "tb" },
          metrics: { fanIn: 1, fanOut: 1, churn: 0, commits: 1 },
          authors: [],
        },
      ],
      edges: [
        { id: "e:ab", from: "u:py:a#f", to: "u:py:b#f", kind: "calls", confidence: 1, evidence: { file: "mod.py", line: 1 } },
        { id: "e:ba", from: "u:py:b#f", to: "u:py:a#f", kind: "calls", confidence: 1, evidence: { file: "mod.py", line: 5 } },
      ],
      externals: [],
      blockGraph: {},
    };
    const snapshot = makeSnapshot(graph);
    const provider = fakeProvider({
      "grouping the files": { clusters: {} },
      "grouping a codebase's architectural layers": { groups: {} },
      "identifying api_flow": { flows: [] },
    });
    const wrapped: Provider = {
      name: provider.name,
      model: provider.model,
      interpret: async (prompt: string) => {
        if (prompt.includes("grouping the files")) return provider.interpret(prompt);
        if (prompt.includes("grouping a codebase's architectural layers")) return provider.interpret(prompt);
        if (prompt.includes("identifying api_flow")) return provider.interpret(prompt);
        return { text: JSON.stringify(passAResponse), tokens: 10 };
      },
    };

    const result = await runInterpreter({ snapshot, graph, provider: wrapped, promptRev: "p1", readSource: () => "def f(): ..." });

    expect(result.units.filter((u) => u.semantics)).toHaveLength(2);
  });

  it("folds a callee's semantic hash into the caller's cache key context, so a callee-semantics change invalidates the caller's cache entry even though the prompt text path is best-effort", async () => {
    const graph = makeGraph();
    const snapshot = makeSnapshot(graph);
    const contexts: (ProviderContext | undefined)[] = [];
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async (prompt: string, context?: ProviderContext): Promise<ProviderResult> => {
        if (prompt.includes("grouping the files")) return { text: JSON.stringify({ clusters: {} }), tokens: 10 };
        if (prompt.includes("grouping a codebase's architectural layers")) return { text: JSON.stringify({ groups: {} }), tokens: 10 };
        if (prompt.includes("identifying api_flow")) return { text: JSON.stringify({ flows: [] }), tokens: 10 };
        if (prompt.includes("Unit: src.admin_tasks.run")) contexts.push(context);
        return { text: JSON.stringify(passAResponse), tokens: 10 };
      }),
    };

    await runInterpreter({ snapshot, graph, provider, promptRev: "p1", readSource: () => "def run(): ..." });

    // admin_tasks.run calls backfill.run — its cache-key context should carry a digest derived
    // from backfill.run's semantic hash, not just its own prompt text.
    expect(contexts[0]?.cacheKeyExtra).toBeTruthy();
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
        if (prompt.includes("grouping a codebase's architectural layers")) {
          return { text: JSON.stringify({ groups: { platform: ["ops"] } }), tokens: 10 };
        }
        if (prompt.includes("identifying api_flow")) return { text: JSON.stringify({ flows: [] }), tokens: 10 };
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
    expect(layer?.group).toBe("platform");
    const opsFiles = result.units.filter((u) => u.parent === layer?.id).map((u) => u.qualname);
    expect(opsFiles.sort()).toEqual(["scripts.backfill", "src.admin_tasks"]);
  });

  it("falls back a layer the LLM's group proposal omits into the checker's fallback group", async () => {
    const graph = makeGraph();
    const snapshot = makeSnapshot(graph);
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
        if (prompt.includes("grouping the files")) {
          return { text: JSON.stringify({ clusters: { ops: ["src/admin_tasks.py", "scripts/backfill.py"] } }), tokens: 10 };
        }
        if (prompt.includes("describing why")) {
          return { text: JSON.stringify({ what: "ops what", how: "ops how", when: "ops when", where: "ops where", why: "ops layer", confidence: 0.8 }), tokens: 10 };
        }
        if (prompt.includes("grouping a codebase's architectural layers")) {
          return { text: JSON.stringify({ groups: {} }), tokens: 10 };
        }
        if (prompt.includes("identifying api_flow")) {
          return { text: JSON.stringify({ flows: [] }), tokens: 10 };
        }
        return { text: JSON.stringify(passAResponse), tokens: 10 };
      }),
    };

    const result = await runInterpreter({ snapshot, graph, provider, promptRev: "p1", readSource: () => "def run(): ..." });

    const layer = result.units.find((u) => u.kind === "layer" && u.qualname === "ops");
    expect(layer?.group).toBe("unclustered");
  });

  it("adds an api_flow unit traced from the proposed entry point through real calls edges", async () => {
    const graph = makeGraph();
    const snapshot = makeSnapshot(graph);
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
        if (prompt.includes("grouping the files")) {
          return { text: JSON.stringify({ clusters: {} }), tokens: 10 };
        }
        if (prompt.includes("grouping a codebase's architectural layers")) {
          return { text: JSON.stringify({ groups: {} }), tokens: 10 };
        }
        if (prompt.includes("identifying api_flow")) {
          return {
            text: JSON.stringify({ flows: [{ unit: "u:py:src.admin_tasks.run#f", name: "run admin task", route: "run admin task" }] }),
            tokens: 10,
          };
        }
        if (prompt.includes("describing an api_flow")) {
          return {
            text: JSON.stringify({
              what: "Runs the admin task, which triggers a backfill.",
              how: "Direct call from admin_tasks to backfill.",
              when: "On demand.",
              where: "src/admin_tasks to scripts/backfill.",
              why: "Couples an admin action to a background job.",
              tags: ["ops"],
              confidence: 0.75,
            }),
            tokens: 10,
          };
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

    const flow = result.units.find((u) => u.kind === "api_flow");
    expect(flow).toBeTruthy();
    expect(flow?.route).toBe("run admin task");
    expect(flow?.steps).toEqual(["u:py:src.admin_tasks.run#f", "u:py:scripts.backfill.run#f"]);
    expect(flow?.semantics?.what).toBe("Runs the admin task, which triggers a backfill.");

    const system = result.units.find((u) => u.kind === "system");
    expect(system?.children).toContain(flow?.id);
  });

  it("keeps two distinct flows whose entry points the LLM gives the same route/name string — flow identity must not collide just because the LLM picked the same label twice", async () => {
    const graph: SymbolGraph = {
      units: [
        {
          id: "u:py:src.a.run#f",
          kind: "function",
          name: "run",
          qualname: "src.a.run",
          lang: "python",
          parent: null,
          children: [],
          loc: { file: "src/a.py", start: 1, end: 5 },
          sloc: 3,
          params: [],
          returns: null,
          bases: [],
          hash: { struct: "sa", text: "ta" },
          metrics: { fanIn: 0, fanOut: 1, churn: 0, commits: 1 },
          authors: [],
        },
        {
          id: "u:py:src.b.run#f",
          kind: "function",
          name: "run",
          qualname: "src.b.run",
          lang: "python",
          parent: null,
          children: [],
          loc: { file: "src/b.py", start: 1, end: 5 },
          sloc: 3,
          params: [],
          returns: null,
          bases: [],
          hash: { struct: "sb", text: "tb" },
          metrics: { fanIn: 0, fanOut: 1, churn: 0, commits: 1 },
          authors: [],
        },
        {
          id: "u:py:src.a.next#f",
          kind: "function",
          name: "next",
          qualname: "src.a.next",
          lang: "python",
          parent: null,
          children: [],
          loc: { file: "src/a.py", start: 7, end: 10 },
          sloc: 3,
          params: [],
          returns: null,
          bases: [],
          hash: { struct: "sc", text: "tc" },
          metrics: { fanIn: 1, fanOut: 0, churn: 0, commits: 1 },
          authors: [],
        },
        {
          id: "u:py:src.b.next#f",
          kind: "function",
          name: "next",
          qualname: "src.b.next",
          lang: "python",
          parent: null,
          children: [],
          loc: { file: "src/b.py", start: 7, end: 10 },
          sloc: 3,
          params: [],
          returns: null,
          bases: [],
          hash: { struct: "sd", text: "td" },
          metrics: { fanIn: 1, fanOut: 0, churn: 0, commits: 1 },
          authors: [],
        },
      ],
      edges: [
        { id: "e:a", from: "u:py:src.a.run#f", to: "u:py:src.a.next#f", kind: "calls", confidence: 1, evidence: { file: "src/a.py", line: 2 } },
        { id: "e:b", from: "u:py:src.b.run#f", to: "u:py:src.b.next#f", kind: "calls", confidence: 1, evidence: { file: "src/b.py", line: 2 } },
      ],
      externals: [],
      blockGraph: {},
    };
    const snapshot = makeSnapshot(graph);
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
        if (prompt.includes("grouping the files")) {
          return { text: JSON.stringify({ clusters: {} }), tokens: 10 };
        }
        if (prompt.includes("grouping a codebase's architectural layers")) {
          return { text: JSON.stringify({ groups: {} }), tokens: 10 };
        }
        if (prompt.includes("identifying api_flow")) {
          return {
            text: JSON.stringify({
              flows: [
                { unit: "u:py:src.a.run#f", name: "same route", route: "same route" },
                { unit: "u:py:src.b.run#f", name: "same route", route: "same route" },
              ],
            }),
            tokens: 10,
          };
        }
        if (prompt.includes("describing an api_flow")) {
          return {
            text: JSON.stringify({
              what: "does something",
              how: "somehow",
              when: "sometime",
              where: "somewhere",
              why: "some reason",
              tags: [],
              confidence: 0.7,
            }),
            tokens: 10,
          };
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

    const flows = result.units.filter((u) => u.kind === "api_flow");
    expect(flows).toHaveLength(2);
    const flowIds = flows.map((f) => f.id);
    expect(new Set(flowIds).size).toBe(2);

    const system = result.units.find((u) => u.kind === "system");
    expect(flowIds.every((id) => system?.children.includes(id))).toBe(true);
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
        if (prompt.includes("grouping a codebase's architectural layers")) {
          return { text: JSON.stringify({ groups: { platform: [clusterName] } }), tokens: 10 };
        }
        if (prompt.includes("identifying api_flow")) {
          return { text: JSON.stringify({ flows: [] }), tokens: 10 };
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
        if (prompt.includes("grouping a codebase's architectural layers")) {
          return { text: JSON.stringify({ groups: { platform: ["ops"] } }), tokens: 10 };
        }
        if (prompt.includes("identifying api_flow")) {
          return { text: JSON.stringify({ flows: [] }), tokens: 10 };
        }
        if (prompt.includes("Unit: scripts.backfill.run")) {
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
    const graph: SymbolGraph = { units, edges: [], externals: [], blockGraph: {} };
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
        if (prompt.includes("grouping a codebase's architectural layers")) {
          return { text: JSON.stringify({ groups: {} }), tokens: 10 };
        }
        if (prompt.includes("identifying api_flow")) {
          return { text: JSON.stringify({ flows: [] }), tokens: 10 };
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

  it("wires a function's blockGraph into block units parented under it, with control_flow edges", async () => {
    const graph = makeGraph();
    graph.blockGraph = {
      "src.admin_tasks.run": {
        blocks: [
          { id: "u:block:entry1", blockType: "entry", startLine: 3, endLine: 3, condition: null },
          { id: "u:block:dec1", blockType: "decision", startLine: 4, endLine: 4, condition: "x > 0" },
          { id: "u:block:merge1", blockType: "merge", startLine: 6, endLine: 6, condition: null },
        ],
        edges: [
          { from: "u:block:entry1", to: "u:block:dec1", edgeType: "sequential" },
          { from: "u:block:dec1", to: "u:block:merge1", edgeType: "true" },
          { from: "u:block:dec1", to: "u:block:merge1", edgeType: "false" },
        ],
      },
    };
    const snapshot = makeSnapshot(graph);
    const provider = fakeProvider({
      "grouping the files": { clusters: {} },
      "grouping a codebase's architectural layers": { groups: {} },
      "identifying api_flow": { flows: [] },
    });
    const wrapped: Provider = {
      name: provider.name,
      model: provider.model,
      interpret: async (prompt: string) => {
        if (prompt.includes("grouping the files")) return provider.interpret(prompt);
        if (prompt.includes("grouping a codebase's architectural layers")) return provider.interpret(prompt);
        if (prompt.includes("identifying api_flow")) return provider.interpret(prompt);
        return { text: JSON.stringify(passAResponse), tokens: 10 };
      },
    };

    const result = await runInterpreter({ snapshot, graph, provider: wrapped, promptRev: "p1", readSource: () => "def run(): ..." });

    const runUnit = result.units.find((u) => u.id === "u:py:src.admin_tasks.run#f");
    expect(runUnit).toBeTruthy();

    const blockUnits = result.units.filter((u) => u.kind === "block");
    expect(blockUnits).toHaveLength(3);
    expect(blockUnits.every((u) => u.parent === runUnit!.id)).toBe(true);
    expect(runUnit!.children).toEqual(expect.arrayContaining(blockUnits.map((b) => b.id)));

    const decisionUnit = blockUnits.find((u) => u.id === "u:block:dec1");
    expect(decisionUnit?.name).toBe("x > 0");

    const cfEdges = result.edges.filter((e) => e.kind === "control_flow");
    expect(cfEdges).toHaveLength(3);
    expect(cfEdges.map((e) => e.flowType).sort()).toEqual(["false", "sequential", "true"]);
  });

  it("produces zero block units for a function with no blockGraph entry", async () => {
    const graph = makeGraph();
    const snapshot = makeSnapshot(graph);
    const provider = fakeProvider({
      "grouping the files": { clusters: {} },
      "grouping a codebase's architectural layers": { groups: {} },
      "identifying api_flow": { flows: [] },
    });
    const wrapped: Provider = {
      name: provider.name,
      model: provider.model,
      interpret: async (prompt: string) => {
        if (prompt.includes("grouping the files")) return provider.interpret(prompt);
        if (prompt.includes("grouping a codebase's architectural layers")) return provider.interpret(prompt);
        if (prompt.includes("identifying api_flow")) return provider.interpret(prompt);
        return { text: JSON.stringify(passAResponse), tokens: 10 };
      },
    };

    const result = await runInterpreter({ snapshot, graph, provider: wrapped, promptRev: "p1", readSource: () => "def run(): ..." });

    expect(result.units.filter((u) => u.kind === "block")).toHaveLength(0);
  });
});

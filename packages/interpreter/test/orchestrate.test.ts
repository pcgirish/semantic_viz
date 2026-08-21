import { describe, expect, it, vi } from "vitest";
import { finalizeSnapshot, runInterpreter } from "../src/orchestrate.js";
import { validateSnapshotInvariants } from "@scv/schema";
import type { Provider, ProviderContext, ProviderResult } from "../src/provider.js";
import type { SymbolGraph } from "@scv/extractor";
import type { Snapshot, Unit } from "@scv/schema";

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
    routes: [],
  };
}

/**
 * Adds the enclosing module unit for any function/class the fixture declared with `parent: null`.
 * Real extraction never emits a bare leaf — every symbol sits in the file that declares it — but
 * fixtures written to exercise Pass A ordering or flow tracing skip the module they don't assert
 * on. Since `finalizeSnapshot` now validates its own output, those shortcuts would read as
 * hierarchy defects. One module per file, id derived from the file path.
 */
function withModuleParents(graph: SymbolGraph): SymbolGraph {
  const loose = graph.units.filter((u) => u.parent === null && u.kind !== "module");
  if (loose.length === 0) return graph;

  const byFile = new Map<string, typeof loose>();
  for (const unit of loose) {
    const existing = byFile.get(unit.loc.file);
    if (existing) existing.push(unit);
    else byFile.set(unit.loc.file, [unit]);
  }

  const modules = [...byFile].map(([file, members]) => {
    const qualname = file.replace(/\.[^./]+$/, "").replace(/\//g, ".");
    return {
      id: `u:py:${qualname}#m`,
      kind: "module" as const,
      name: qualname.split(".").pop()!,
      qualname,
      lang: "python",
      parent: null,
      children: members.map((m) => m.id),
      loc: { file, start: 1, end: 1 },
      sloc: members.reduce((sum, m) => sum + m.sloc, 0),
      params: [],
      returns: null,
      bases: [],
      hash: { struct: `s-${qualname}`, text: `t-${qualname}` },
      metrics: { fanIn: 0, fanOut: 0, churn: 0, commits: 1 },
      authors: [],
    };
  });
  const moduleOfFile = new Map(modules.map((m) => [m.loc.file, m.id]));

  return {
    ...graph,
    units: [
      ...modules,
      ...graph.units.map((u) =>
        u.parent === null && u.kind !== "module" ? { ...u, parent: moduleOfFile.get(u.loc.file)! } : u,
      ),
    ],
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
        if (prompt.includes("Base directories")) {
          return {
            text: JSON.stringify({ merges: { ops: ["src", "scripts"] } }),
            tokens: 10,
          };
        }
        if (prompt.includes("describing why")) {
          return { text: JSON.stringify({ what: "ops what", how: "ops how", when: "ops when", where: "ops where", why: "ops layer", confidence: 0.8 }), tokens: 10 };
        }
        if (prompt.includes("Base layers")) {
          return { text: JSON.stringify({ merges: { platform: ["ops"] } }), tokens: 10 };
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
        if (prompt.includes("Base directories")) return { text: JSON.stringify({ merges: {} }), tokens: 10 };
        if (prompt.includes("Base layers")) return { text: JSON.stringify({ merges: {} }), tokens: 10 };
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
        if (prompt.includes("Base directories")) {
          passBPrompt = prompt;
          return { text: JSON.stringify({ merges: {} }), tokens: 10 };
        }
        if (prompt.includes("Base layers")) {
          return { text: JSON.stringify({ merges: {} }), tokens: 10 };
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
        if (prompt.includes("Base directories")) return { text: JSON.stringify({ merges: {} }), tokens: 10 };
        if (prompt.includes("Base layers")) return { text: JSON.stringify({ merges: {} }), tokens: 10 };
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
    const graph: SymbolGraph = withModuleParents({
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
      routes: [],
    });
    const snapshot = makeSnapshot(graph);
    const order: string[] = [];
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
        if (prompt.includes("Base directories")) return { text: JSON.stringify({ merges: {} }), tokens: 10 };
        if (prompt.includes("Base layers")) return { text: JSON.stringify({ merges: {} }), tokens: 10 };
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
    const graph: SymbolGraph = withModuleParents({
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
      routes: [],
    });
    const snapshot = makeSnapshot(graph);
    const provider = fakeProvider({
      "grouping the files": { merges: {} },
      "grouping a codebase's architectural layers": { merges: {} },
      "identifying api_flow": { flows: [] },
    });
    const wrapped: Provider = {
      name: provider.name,
      model: provider.model,
      interpret: async (prompt: string) => {
        if (prompt.includes("Base directories")) return provider.interpret(prompt);
        if (prompt.includes("Base layers")) return provider.interpret(prompt);
        if (prompt.includes("identifying api_flow")) return provider.interpret(prompt);
        return { text: JSON.stringify(passAResponse), tokens: 10 };
      },
    };

    const result = await runInterpreter({ snapshot, graph, provider: wrapped, promptRev: "p1", readSource: () => "def f(): ..." });

    // Both sides of the cycle get analyzed — the point of the test. Asserting on the leaves by id
    // rather than counting every semantic unit, since the enclosing module also gets a oneLiner.
    const analyzed = result.units.filter((u) => u.semantics).map((u) => u.id);
    expect(analyzed).toContain("u:py:a#f");
    expect(analyzed).toContain("u:py:b#f");
  });

  it("folds a callee's semantic hash into the caller's cache key context, so a callee-semantics change invalidates the caller's cache entry even though the prompt text path is best-effort", async () => {
    const graph = makeGraph();
    const snapshot = makeSnapshot(graph);
    const contexts: (ProviderContext | undefined)[] = [];
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async (prompt: string, context?: ProviderContext): Promise<ProviderResult> => {
        if (prompt.includes("Base directories")) return { text: JSON.stringify({ merges: {} }), tokens: 10 };
        if (prompt.includes("Base layers")) return { text: JSON.stringify({ merges: {} }), tokens: 10 };
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
      "Base directories": { merges: { ops: ["src", "scripts"] } },
      "describing why": { what: "ops what", how: "ops how", when: "ops when", where: "ops where", why: "operational scripts", confidence: 0.8 },
    });
    // module units get Pass A too; fall through to passAResponse for anything else
    const wrapped: Provider = {
      name: provider.name,
      model: provider.model,
      interpret: async (prompt: string) => {
        if (prompt.includes("Base directories")) return provider.interpret(prompt);
        if (prompt.includes("describing why")) return provider.interpret(prompt);
        if (prompt.includes("Base layers")) {
          return { text: JSON.stringify({ merges: { platform: ["ops"] } }), tokens: 10 };
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

  it("makes a layer into its own singleton group when Pass C groups omits it from merges", async () => {
    const graph = makeGraph();
    const snapshot = makeSnapshot(graph);
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
        if (prompt.includes("Base directories")) {
          return { text: JSON.stringify({ merges: { ops: ["src", "scripts"] } }), tokens: 10 };
        }
        if (prompt.includes("describing why")) {
          return { text: JSON.stringify({ what: "ops what", how: "ops how", when: "ops when", where: "ops where", why: "ops layer", confidence: 0.8 }), tokens: 10 };
        }
        if (prompt.includes("Base layers")) {
          return { text: JSON.stringify({ merges: {} }), tokens: 10 };
        }
        if (prompt.includes("identifying api_flow")) {
          return { text: JSON.stringify({ flows: [] }), tokens: 10 };
        }
        return { text: JSON.stringify(passAResponse), tokens: 10 };
      }),
    };

    const result = await runInterpreter({ snapshot, graph, provider, promptRev: "p1", readSource: () => "def run(): ..." });

    const layer = result.units.find((u) => u.kind === "layer" && u.qualname === "ops");
    expect(layer?.group).toBe("ops");
  });

  it("adds an api_flow unit traced from the proposed entry point through real calls edges", async () => {
    const graph = makeGraph();
    const snapshot = makeSnapshot(graph);
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
        if (prompt.includes("Base directories")) {
          return { text: JSON.stringify({ merges: {} }), tokens: 10 };
        }
        if (prompt.includes("Base layers")) {
          return { text: JSON.stringify({ merges: {} }), tokens: 10 };
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

  it("populates stepsBranching with labeled success/failure paths for a handler with an if/else, alongside the existing linear steps", async () => {
    const graph: SymbolGraph = withModuleParents({
      units: [
        {
          id: "u:py:src.auth.login#f",
          kind: "function",
          name: "login",
          qualname: "src.auth.login",
          lang: "python",
          parent: null,
          children: [],
          loc: { file: "src/auth.py", start: 1, end: 10 },
          sloc: 8,
          params: [],
          returns: null,
          bases: [],
          hash: { struct: "s1", text: "t1" },
          metrics: { fanIn: 0, fanOut: 2, churn: 0, commits: 1 },
          authors: [],
        },
        {
          id: "u:py:src.auth.issue_token#f",
          kind: "function",
          name: "issue_token",
          qualname: "src.auth.issue_token",
          lang: "python",
          parent: null,
          children: [],
          loc: { file: "src/auth.py", start: 12, end: 14 },
          sloc: 2,
          params: [],
          returns: null,
          bases: [],
          hash: { struct: "s2", text: "t2" },
          metrics: { fanIn: 1, fanOut: 0, churn: 0, commits: 1 },
          authors: [],
        },
        {
          id: "u:py:src.auth.reject#f",
          kind: "function",
          name: "reject",
          qualname: "src.auth.reject",
          lang: "python",
          parent: null,
          children: [],
          loc: { file: "src/auth.py", start: 16, end: 18 },
          sloc: 2,
          params: [],
          returns: null,
          bases: [],
          hash: { struct: "s3", text: "t3" },
          metrics: { fanIn: 1, fanOut: 0, churn: 0, commits: 1 },
          authors: [],
        },
      ],
      edges: [
        {
          id: "e:1",
          from: "u:py:src.auth.login#f",
          to: "u:py:src.auth.issue_token#f",
          kind: "calls",
          confidence: 1,
          evidence: { file: "src/auth.py", line: 5 },
        },
        {
          id: "e:2",
          from: "u:py:src.auth.login#f",
          to: "u:py:src.auth.reject#f",
          kind: "calls",
          confidence: 1,
          evidence: { file: "src/auth.py", line: 7 },
        },
      ],
      externals: [],
      blockGraph: {
        "src.auth.login": {
          blocks: [
            { id: "u:block:entry1", blockType: "entry", startLine: 1, endLine: 3, condition: null },
            { id: "u:block:dec1", blockType: "decision", startLine: 4, endLine: 4, condition: "valid" },
            { id: "u:block:true1", blockType: "sequential", startLine: 5, endLine: 5, condition: null },
            { id: "u:block:false1", blockType: "sequential", startLine: 7, endLine: 7, condition: null },
          ],
          edges: [
            { from: "u:block:entry1", to: "u:block:dec1", edgeType: "sequential" },
            { from: "u:block:dec1", to: "u:block:true1", edgeType: "true" },
            { from: "u:block:dec1", to: "u:block:false1", edgeType: "false" },
          ],
        },
      },
      routes: [],
    });
    const snapshot = makeSnapshot(graph);
    const provider = fakeProvider({
      "grouping the files": { merges: {} },
      "grouping a codebase's architectural layers": { merges: {} },
      "identifying api_flow": { flows: [{ unit: "u:py:src.auth.login#f", name: "login", route: "POST /auth/login" }] },
      "describing an api_flow": {
        what: "Authenticates a user.",
        how: "Validates credentials then issues or rejects.",
        when: "On login.",
        where: "src/auth.",
        why: "Gates access.",
        tags: ["auth"],
        confidence: 0.8,
      },
    });
    const wrapped: Provider = {
      name: provider.name,
      model: provider.model,
      interpret: async (prompt: string) => {
        if (prompt.includes("Base directories")) return provider.interpret(prompt);
        if (prompt.includes("Base layers")) return provider.interpret(prompt);
        if (prompt.includes("identifying api_flow")) return provider.interpret(prompt);
        if (prompt.includes("describing an api_flow")) return provider.interpret(prompt);
        return { text: JSON.stringify(passAResponse), tokens: 10 };
      },
    };

    const result = await runInterpreter({ snapshot, graph, provider: wrapped, promptRev: "p1", readSource: () => "def login(): ..." });

    const flow = result.units.find((u) => u.kind === "api_flow");
    expect(flow).toBeTruthy();
    expect(flow?.steps).toBeTruthy();
    expect(flow?.stepsBranching).toBeTruthy();
    expect(flow?.stepsBranching?.unit).toBe("u:py:src.auth.login#f");
    const children = flow?.stepsBranching?.children ?? [];
    expect(children).toHaveLength(2);
    expect(children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ unit: "u:py:src.auth.issue_token#f", label: "success" }),
        expect.objectContaining({ unit: "u:py:src.auth.reject#f", label: "failure" }),
      ]),
    );
  });

  it("prepends DI/middleware edges (via: 'di') ahead of a handler's own body calls in both steps and stepsBranching", async () => {
    const graph: SymbolGraph = withModuleParents({
      units: [
        {
          id: "u:py:src.orders.create_order#f",
          kind: "function",
          name: "create_order",
          qualname: "src.orders.create_order",
          lang: "python",
          parent: null,
          children: [],
          loc: { file: "src/orders/create_order.py", start: 1, end: 10 },
          sloc: 8,
          params: [],
          returns: null,
          bases: [],
          hash: { struct: "s1", text: "t1" },
          metrics: { fanIn: 0, fanOut: 2, churn: 0, commits: 1 },
          authors: [],
        },
        {
          id: "u:py:src.orders.save#f",
          kind: "function",
          name: "save",
          qualname: "src.orders.save",
          lang: "python",
          parent: null,
          children: [],
          loc: { file: "src/orders/create_order.py", start: 12, end: 14 },
          sloc: 2,
          params: [],
          returns: null,
          bases: [],
          hash: { struct: "s2", text: "t2" },
          metrics: { fanIn: 1, fanOut: 0, churn: 0, commits: 1 },
          authors: [],
        },
        {
          id: "u:py:src.api.middleware.rate_limiter.rate_limit#f",
          kind: "function",
          name: "rate_limit",
          qualname: "src.api.middleware.rate_limiter.rate_limit",
          lang: "python",
          parent: null,
          children: [],
          loc: { file: "src/api/middleware/rate_limiter.py", start: 1, end: 3 },
          sloc: 2,
          params: [],
          returns: null,
          bases: [],
          hash: { struct: "s3", text: "t3" },
          metrics: { fanIn: 1, fanOut: 0, churn: 0, commits: 1 },
          authors: [],
        },
      ],
      edges: [
        {
          id: "e:1",
          from: "u:py:src.orders.create_order#f",
          to: "u:py:src.orders.save#f",
          kind: "calls",
          confidence: 1,
          evidence: { file: "src/orders/create_order.py", line: 5 },
        },
        {
          id: "e:2",
          from: "u:py:src.orders.create_order#f",
          to: "u:py:src.api.middleware.rate_limiter.rate_limit#f",
          kind: "calls",
          confidence: 1,
          evidence: { file: "src/api/routes.py", line: 6 },
          via: "di",
        },
      ],
      externals: [],
      blockGraph: {},
      routes: [],
    });
    const snapshot = makeSnapshot(graph);
    const provider = fakeProvider({
      "grouping the files": { merges: {} },
      "grouping a codebase's architectural layers": { merges: {} },
      "identifying api_flow": { flows: [{ unit: "u:py:src.orders.create_order#f", name: "create_order", route: "POST /orders" }] },
      "describing an api_flow": {
        what: "Creates an order.",
        how: "Rate-limited then saved.",
        when: "On order creation.",
        where: "src/orders.",
        why: "Places an order.",
        tags: ["orders"],
        confidence: 0.8,
      },
    });
    const wrapped: Provider = {
      name: provider.name,
      model: provider.model,
      interpret: async (prompt: string) => {
        if (prompt.includes("Base directories")) return provider.interpret(prompt);
        if (prompt.includes("Base layers")) return provider.interpret(prompt);
        if (prompt.includes("identifying api_flow")) return provider.interpret(prompt);
        if (prompt.includes("describing an api_flow")) return provider.interpret(prompt);
        return { text: JSON.stringify(passAResponse), tokens: 10 };
      },
    };

    const result = await runInterpreter({ snapshot, graph, provider: wrapped, promptRev: "p1", readSource: () => "def create_order(): ..." });

    const flow = result.units.find((u) => u.kind === "api_flow");
    expect(flow).toBeTruthy();
    expect(flow?.steps).toEqual(["u:py:src.api.middleware.rate_limiter.rate_limit#f", "u:py:src.orders.create_order#f", "u:py:src.orders.save#f"]);
    expect(flow?.stepsBranching?.unit).toBe("u:py:src.api.middleware.rate_limiter.rate_limit#f");
    expect(flow?.stepsBranching?.children).toEqual([
      expect.objectContaining({
        unit: "u:py:src.orders.create_order#f",
        children: [expect.objectContaining({ unit: "u:py:src.orders.save#f" })],
      }),
    ]);
  });

  it("keeps two distinct flows whose entry points the LLM gives the same route/name string — flow identity must not collide just because the LLM picked the same label twice", async () => {
    const graph: SymbolGraph = withModuleParents({
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
      routes: [],
    });
    const snapshot = makeSnapshot(graph);
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
        if (prompt.includes("Base directories")) {
          return { text: JSON.stringify({ merges: {} }), tokens: 10 };
        }
        if (prompt.includes("Base layers")) {
          return { text: JSON.stringify({ merges: {} }), tokens: 10 };
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
        if (prompt.includes("Base directories")) {
          return {
            text: JSON.stringify({ merges: { [clusterName]: ["src/admin_tasks.py", "scripts/backfill.py"] } }),
            tokens: 10,
          };
        }
        if (prompt.includes("describing why")) {
          return { text: JSON.stringify({ what: `${layerName} what`, how: `${layerName} how`, when: `${layerName} when`, where: `${layerName} where`, why: `${layerName} layer`, confidence: 0.8 }), tokens: 10 };
        }
        if (prompt.includes("Base layers")) {
          return { text: JSON.stringify({ merges: { platform: [clusterName] } }), tokens: 10 };
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
        if (prompt.includes("Base directories")) {
          return {
            text: JSON.stringify({ merges: { ops: ["src", "scripts"] } }),
            tokens: 10,
          };
        }
        if (prompt.includes("describing why")) {
          return { text: JSON.stringify({ what: "ops what", how: "ops how", when: "ops when", where: "ops where", why: "ops layer", confidence: 0.8 }), tokens: 10 };
        }
        if (prompt.includes("Base layers")) {
          return { text: JSON.stringify({ merges: { platform: ["ops"] } }), tokens: 10 };
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
    const graph: SymbolGraph = withModuleParents({ units, edges: [], externals: [], blockGraph: {}, routes: [] });
    const snapshot = makeSnapshot(graph);

    let inFlight = 0;
    let maxInFlight = 0;
    let passACalls = 0;
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
        if (prompt.includes("Base directories")) {
          return { text: JSON.stringify({ merges: {} }), tokens: 10 };
        }
        if (prompt.includes("Base layers")) {
          return { text: JSON.stringify({ merges: {} }), tokens: 10 };
        }
        if (prompt.includes("identifying api_flow")) {
          return { text: JSON.stringify({ flows: [] }), tokens: 10 };
        }
        // Count only the leaf prompts this test is about — the enclosing modules draw their own
        // narration prompts, which are not the concurrency-capped path under test.
        if (/Unit: mod\d+\.run\b/.test(prompt)) passACalls++;
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
      "grouping the files": { merges: {} },
      "grouping a codebase's architectural layers": { merges: {} },
      "identifying api_flow": { flows: [] },
    });
    const wrapped: Provider = {
      name: provider.name,
      model: provider.model,
      interpret: async (prompt: string) => {
        if (prompt.includes("Base directories")) return provider.interpret(prompt);
        if (prompt.includes("Base layers")) return provider.interpret(prompt);
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

    // Pass A didn't label the merge block (passAResponse has no entry for "u:block:merge1"),
    // so it falls back — the raw blockType "merge" would read as internal debug output.
    const mergeUnit = blockUnits.find((u) => u.id === "u:block:merge1");
    expect(mergeUnit?.name).not.toBe("merge");
  });

  it("produces zero block units for a function with no blockGraph entry", async () => {
    const graph = makeGraph();
    const snapshot = makeSnapshot(graph);
    const provider = fakeProvider({
      "grouping the files": { merges: {} },
      "grouping a codebase's architectural layers": { merges: {} },
      "identifying api_flow": { flows: [] },
    });
    const wrapped: Provider = {
      name: provider.name,
      model: provider.model,
      interpret: async (prompt: string) => {
        if (prompt.includes("Base directories")) return provider.interpret(prompt);
        if (prompt.includes("Base layers")) return provider.interpret(prompt);
        if (prompt.includes("identifying api_flow")) return provider.interpret(prompt);
        return { text: JSON.stringify(passAResponse), tokens: 10 };
      },
    };

    const result = await runInterpreter({ snapshot, graph, provider: wrapped, promptRev: "p1", readSource: () => "def run(): ..." });

    expect(result.units.filter((u) => u.kind === "block")).toHaveLength(0);
  });

  it("reports Pass A progress with phase, done/total counts, and the in-flight qualname", async () => {
    const graph = makeGraph();
    const snapshot = makeSnapshot(graph);
    const provider = fakeProvider({
      "grouping the files": { merges: {} },
      "grouping a codebase's architectural layers": { merges: {} },
      "identifying api_flow": { flows: [] },
    });
    const wrapped: Provider = {
      name: provider.name,
      model: provider.model,
      interpret: async (prompt: string) => {
        if (prompt.includes("Base directories")) return provider.interpret(prompt);
        if (prompt.includes("Base layers")) return provider.interpret(prompt);
        if (prompt.includes("identifying api_flow")) return provider.interpret(prompt);
        return { text: JSON.stringify(passAResponse), tokens: 10 };
      },
    };

    const calls: { phase: string; done: number; total: number; current?: string }[] = [];
    await runInterpreter({
      snapshot,
      graph,
      provider: wrapped,
      promptRev: "p1",
      readSource: () => "def run(): ...",
      reportProgress: (phase, done, total, current) => {
        calls.push({ phase, done, total, current });
      },
    });

    const passACalls = calls.filter((c) => c.phase === "pass A");
    expect(passACalls.length).toBeGreaterThan(0);
    expect(passACalls.every((c) => c.total === 2)).toBe(true);
    const dispatchedQualnames = new Set(passACalls.map((c) => c.current));
    expect(dispatchedQualnames).toEqual(new Set(["scripts.backfill.run", "src.admin_tasks.run"]));
    const completionCalls = passACalls.filter((c) => c.done > 0);
    expect(completionCalls.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...completionCalls.map((c) => c.done))).toBe(2);
  });
});

describe("runInterpreter — test units are excluded from LLM passes", () => {
  function makeGraphWithTestUnit(): SymbolGraph {
    const graph = makeGraph();
    graph.units.push(
      {
        id: "u:py:tests.test_admin_tasks#m",
        kind: "module",
        name: "test_admin_tasks",
        qualname: "tests",
        lang: "python",
        parent: null,
        children: ["u:py:tests.test_admin_tasks.test_run#f"],
        loc: { file: "tests/test_admin_tasks.py", start: 1, end: 10 },
        sloc: 4,
        params: [],
        returns: null,
        bases: [],
        hash: { struct: "s-test-mod", text: "t-test-mod" },
        metrics: { fanIn: 0, fanOut: 0, churn: 0, commits: 1 },
        authors: [],
      },
      {
        id: "u:py:tests.test_admin_tasks.test_run#f",
        kind: "function",
        name: "test_run",
        qualname: "tests.test_run",
        lang: "python",
        parent: "u:py:tests.test_admin_tasks#m",
        children: [],
        loc: { file: "tests/test_admin_tasks.py", start: 3, end: 8 },
        sloc: 3,
        params: [],
        returns: null,
        bases: [],
        hash: { struct: "s-test-fn", text: "t-test-fn" },
        metrics: { fanIn: 0, fanOut: 0, churn: 0, commits: 1 },
        authors: [],
      },
    );
    return graph;
  }

  it("never calls the provider for a unit under a flattened tests module", async () => {
    const graph = makeGraphWithTestUnit();
    const snapshot = makeSnapshot(graph);
    const calledFor: string[] = [];
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
        if (prompt.includes("Base directories")) return { text: JSON.stringify({ merges: {} }), tokens: 10 };
        if (prompt.includes("Base layers")) return { text: JSON.stringify({ merges: {} }), tokens: 10 };
        if (prompt.includes("identifying api_flow")) return { text: JSON.stringify({ flows: [] }), tokens: 10 };
        calledFor.push(prompt);
        return { text: JSON.stringify(passAResponse), tokens: 10 };
      }),
    };

    await runInterpreter({
      snapshot,
      graph,
      provider,
      promptRev: "p1",
      readSource: (file) => (file.startsWith("tests/") ? "def test_run(): ..." : "def run(): ..."),
    });

    expect(calledFor.some((p) => p.includes("test_run"))).toBe(false);
  });

  it("still runs Pass A for a sibling non-test unit while excluding the test unit", async () => {
    const graph = makeGraphWithTestUnit();
    const snapshot = makeSnapshot(graph);
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
        if (prompt.includes("Base directories")) return { text: JSON.stringify({ merges: {} }), tokens: 10 };
        if (prompt.includes("Base layers")) return { text: JSON.stringify({ merges: {} }), tokens: 10 };
        if (prompt.includes("identifying api_flow")) return { text: JSON.stringify({ flows: [] }), tokens: 10 };
        return { text: JSON.stringify(passAResponse), tokens: 10 };
      }),
    };

    const result = await runInterpreter({ snapshot, graph, provider, promptRev: "p1", readSource: () => "def run(): ..." });

    const run = result.units.find((u) => u.id === "u:py:src.admin_tasks.run#f");
    const testRun = result.units.find((u) => u.id === "u:py:tests.test_admin_tasks.test_run#f");
    expect(run?.semantics?.what).toBe("does a thing");
    expect(testRun?.semantics).toBeFalsy();
  });

  it("runs Pass Docs over repoContext.docs and folds summaries + a directory tree into Pass B/C prompts", async () => {
    const graph = makeGraph();
    const snapshot = makeSnapshot(graph);
    const docExtract = {
      purpose: "A backend that runs admin tasks.",
      modules: [{ name: "ops", description: "operational scripts", paths: ["scripts"] }],
      architecture_notes: ["scripts/ calls into src/ helpers"],
    };
    let passBPrompt = "";
    let passCPrompt = "";
    let passCGroupsPrompt = "";
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
        if (prompt.includes("extracting structural signal")) return { text: JSON.stringify(docExtract), tokens: 10 };
        if (prompt.includes("Base directories")) {
          passBPrompt = prompt;
          return { text: JSON.stringify({ merges: { ops: ["src", "scripts"] } }), tokens: 10 };
        }
        if (prompt.includes("describing why")) {
          passCPrompt = prompt;
          return { text: JSON.stringify({ what: "w", how: "h", when: "wh", where: "wr", why: "why", confidence: 0.8 }), tokens: 10 };
        }
        if (prompt.includes("Base layers")) {
          passCGroupsPrompt = prompt;
          return { text: JSON.stringify({ merges: { platform: ["ops"] } }), tokens: 10 };
        }
        if (prompt.includes("identifying api_flow")) return { text: JSON.stringify({ flows: [] }), tokens: 10 };
        return { text: JSON.stringify(passAResponse), tokens: 10 };
      }),
    };

    await runInterpreter({
      snapshot,
      graph,
      provider,
      promptRev: "p1",
      readSource: () => "def run(): ...",
      repoContext: { docs: [{ path: "README.md", content: "# Orderly\n\nRuns admin tasks." }] },
    });

    expect(passBPrompt).toContain("Repo context");
    expect(passBPrompt).toContain("Base directories");
    expect(passBPrompt).toContain("scripts");
    expect(passCPrompt).toContain("Repo context");
    expect(passCGroupsPrompt).toContain("Repo context");
  });
});

describe("runInterpreter — root policy: every unit has a parent", () => {
  /** A graph with three orphan classes: a test module, a module no cluster will claim,
   *  and the layer/flow units the passes themselves create. */
  function makeGraphWithOrphanClasses(): SymbolGraph {
    const graph = makeGraph();
    graph.units.push(
      {
        id: "u:py:tests.test_admin_tasks#m",
        kind: "module",
        name: "test_admin_tasks",
        qualname: "tests",
        lang: "python",
        parent: null,
        children: [],
        loc: { file: "tests/test_admin_tasks.py", start: 1, end: 10 },
        sloc: 4,
        params: [],
        returns: null,
        bases: [],
        hash: { struct: "s-test-mod", text: "t-test-mod" },
        metrics: { fanIn: 0, fanOut: 0, churn: 0, commits: 1 },
        authors: [],
      },
      {
        id: "u:py:fixtures.sample#m",
        kind: "module",
        name: "sample",
        qualname: "fixtures.sample",
        lang: "python",
        parent: null,
        children: [],
        loc: { file: "fixtures/sample.py", start: 1, end: 6 },
        sloc: 3,
        params: [],
        returns: null,
        bases: [],
        hash: { struct: "s-fix-mod", text: "t-fix-mod" },
        metrics: { fanIn: 0, fanOut: 0, churn: 0, commits: 1 },
        authors: [],
      },
    );
    return graph;
  }

  /** Clusters only src/, deliberately leaving fixtures/sample.py unclaimed. */
  function makeSrcOnlyProvider(): Provider {
    return {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
        if (prompt.includes("Base directories")) return { text: JSON.stringify({ merges: {} }), tokens: 10 };
        if (prompt.includes("Base layers")) return { text: JSON.stringify({ merges: {} }), tokens: 10 };
        if (prompt.includes("identifying api_flow")) return { text: JSON.stringify({ flows: [] }), tokens: 10 };
        return { text: JSON.stringify(passAResponse), tokens: 10 };
      }),
    };
  }

  it("leaves no unit other than the system root with a null parent", async () => {
    const graph = makeGraphWithOrphanClasses();
    const result = await runInterpreter({
      snapshot: makeSnapshot(graph),
      graph,
      provider: makeSrcOnlyProvider(),
      promptRev: "p1",
      readSource: () => "def run(): ...",
    });

    const orphans = result.units.filter((u) => u.parent === null && u.kind !== "system");
    expect(orphans.map((u) => `${u.kind}:${u.id}`)).toEqual([]);
  });

  it("gives every layer the system as its parent, reciprocally", async () => {
    const graph = makeGraphWithOrphanClasses();
    const result = await runInterpreter({
      snapshot: makeSnapshot(graph),
      graph,
      provider: makeSrcOnlyProvider(),
      promptRev: "p1",
      readSource: () => "def run(): ...",
    });

    const system = result.units.find((u) => u.kind === "system");
    const layers = result.units.filter((u) => u.kind === "layer");
    expect(layers.length).toBeGreaterThan(0);
    for (const layer of layers) {
      expect(layer.parent).toBe(system?.id);
      expect(system?.children).toContain(layer.id);
    }
  });

  it("parents test modules through the normal clustering path, not a special container", async () => {
    const graph = makeGraphWithOrphanClasses();
    const result = await runInterpreter({
      snapshot: makeSnapshot(graph),
      graph,
      provider: makeSrcOnlyProvider(),
      promptRev: "p1",
      readSource: () => "def run(): ...",
    });

    // Pass B clusters files by directory, so tests/ becomes a layer like any other. The
    // coverage-only policy is about analysis, not placement: the module is present and
    // parented, but carries no LLM semantics.
    const testModule = result.units.find((u) => u.id === "u:py:tests.test_admin_tasks#m");
    expect(testModule?.parent).not.toBeNull();
    expect(testModule?.semantics).toBeFalsy();
  });

  it("collects modules no layer claimed under an unclustered container", async () => {
    const graph = makeGraphWithOrphanClasses();
    // No layers pass output at all: every module is unclaimed, which is the case that would
    // otherwise leave the snapshot full of parent: null units.
    const result = finalizeSnapshot({
      snapshot: makeSnapshot(graph),
      provider: makeSrcOnlyProvider(),
      promptRev: "p1",
      systemName: undefined,
      // Leaves keep their module parent — only the modules themselves are unclaimed.
      units: makeSnapshot(graph).units.map((u) => (u.kind === "module" ? { ...u, parent: null } : u)),
      blockUnits: [],
      blockEdges: [],
      layerUnits: [],
      parentOverride: new Map(),
      flowUnits: [],
    });

    const system = result.units.find((u) => u.kind === "system");
    const bucket = result.units.find((u) => u.kind === "unclustered");
    expect(bucket).toBeDefined();
    expect(bucket?.parent).toBe(system?.id);
    expect(system?.children).toContain(bucket?.id);
    expect(bucket?.semantics).toBeNull();
    expect(bucket?.provenance.source).toBe("static");

    const orphans = result.units.filter((u) => u.parent === null && u.kind !== "system");
    expect(orphans).toEqual([]);
  });

  it("emits no container when every module already has a layer", async () => {
    const graph = makeGraph();
    const result = await runInterpreter({
      snapshot: makeSnapshot(graph),
      graph,
      provider: makeSrcOnlyProvider(),
      promptRev: "p1",
      readSource: () => "def run(): ...",
    });

    // An empty container would be a tile standing for nothing.
    expect(result.units.find((u) => u.kind === "unclustered")).toBeUndefined();
  });

  it("counts only layer units in the system's layer metric", async () => {
    const graph = makeGraphWithOrphanClasses();
    const result = await runInterpreter({
      snapshot: makeSnapshot(graph),
      graph,
      provider: makeSrcOnlyProvider(),
      promptRev: "p1",
      readSource: () => "def run(): ...",
    });

    const system = result.units.find((u) => u.kind === "system");
    const layers = result.units.filter((u) => u.kind === "layer").length;
    expect(system?.metrics?.layers).toBe(layers);
  });
});

/** A provider that answers every pass with its minimal well-formed response. */
function passThroughProvider(): Provider {
  return {
    name: "fake",
    model: "fake-model",
    interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
      if (prompt.includes("Base directories")) return { text: JSON.stringify({ merges: {} }), tokens: 10 };
      if (prompt.includes("Base layers")) return { text: JSON.stringify({ merges: {} }), tokens: 10 };
      if (prompt.includes("identifying api_flow")) return { text: JSON.stringify({ flows: [] }), tokens: 10 };
      return { text: JSON.stringify(passAResponse), tokens: 10 };
    }),
  };
}

describe("finalizeSnapshot — tree reciprocity", () => {
  async function analyze() {
    const graph = makeGraph();
    return runInterpreter({
      snapshot: makeSnapshot(graph),
      graph,
      provider: passThroughProvider(),
      promptRev: "p1",
      readSource: () => "def run(): ...",
    });
  }

  it("parents every layer and flow unit to the system", async () => {
    const result = await analyze();
    const sysId = result.units.find((u) => u.kind === "system")!.id;

    const topLevel = result.units.filter((u) => u.kind === "layer" || u.kind === "api_flow");
    expect(topLevel.length).toBeGreaterThan(0);
    for (const unit of topLevel) expect(unit.parent).toBe(sysId);
  });

  it("agrees in both directions on what the system's children are", async () => {
    const result = await analyze();
    const system = result.units.find((u) => u.kind === "system")!;

    // Set equality, not containment: a child the system lists but that claims another parent is
    // just as broken as one that claims the system without being listed.
    const claimed = result.units.filter((u) => u.parent === system.id).map((u) => u.id).sort();
    expect([...system.children].sort()).toEqual(claimed);
  });

  it("keeps every layer's children modules, and every module under its layer", async () => {
    const result = await analyze();
    const byId = new Map(result.units.map((u) => [u.id, u]));

    const layers = result.units.filter((u) => u.kind === "layer");
    expect(layers.length).toBeGreaterThan(0);
    for (const layer of layers) {
      for (const childId of layer.children) {
        expect(byId.get(childId)?.kind).toBe("module");
        expect(byId.get(childId)?.parent).toBe(layer.id);
      }
    }
  });

  it("counts only layers in metrics.layers, not the flows that share the system's children", async () => {
    const result = await analyze();
    const system = result.units.find((u) => u.kind === "system")!;

    expect(system.metrics?.layers).toBe(result.units.filter((u) => u.kind === "layer").length);
  });
});

describe("finalizeSnapshot — invariant enforcement", () => {
  it("throws when the snapshot it just built breaks a tree invariant", () => {
    const graph = makeGraph();
    const snapshot = makeSnapshot(graph);
    const modules = snapshot.units.filter((u) => u.kind === "module").map((u) => ({ ...u, children: [] }));

    // A layer claiming a child that does not name it back — the exact upward break Phase 1
    // fixed. Analyze time is where this is a bug, not a legacy artifact, so it must not pass.
    const layer: Unit = {
      ...modules[0]!,
      id: "u:layer:bogus",
      kind: "layer",
      name: "bogus",
      qualname: "bogus",
      children: modules.map((m) => m.id),
    };

    expect(() =>
      finalizeSnapshot({
        snapshot,
        provider: fakeProvider({}),
        promptRev: "p1",
        systemName: undefined,
        units: modules.map((m) => ({ ...m, parent: null })),
        blockUnits: [],
        blockEdges: [],
        layerUnits: [layer],
        parentOverride: new Map(),
        flowUnits: [],
      }),
    ).toThrow(/invariant/i);
  });

  it("builds a snapshot that passes its own invariants on a normal run", async () => {
    const graph = makeGraph();
    const result = await runInterpreter({
      snapshot: makeSnapshot(graph),
      graph,
      provider: passThroughProvider(),
      promptRev: "p1",
      readSource: () => "def run(): ...",
    });

    expect(validateSnapshotInvariants(result).findings).toEqual([]);
  });

  it("emits rollupProvenance naming the concrete edges each layer rollup stands for", async () => {
    const graph = makeGraph();
    const result = await runInterpreter({
      snapshot: makeSnapshot(graph),
      graph,
      provider: passThroughProvider(),
      promptRev: "p1",
      readSource: () => "def run(): ...",
    });

    // src/ and scripts/ land in different layers, so the one calls edge between them rolls up.
    const rollups = result.edges.filter((e) => e.rollup === true);
    expect(rollups).toHaveLength(1);
    expect(rollups[0]?.rollupProvenance).toEqual({ edges: ["e:1"], count: 1, weight: 1 });
    expect(rollups[0]?.weight).toBe(1);
  });
});

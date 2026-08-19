import { describe, expect, it, vi } from "vitest";
import { runPassC, runPassCGroups } from "../src/pass-c.js";
import type { Provider, ProviderResult } from "../src/provider.js";
import type { ClusterProposal } from "../src/checker.js";

const clusters: ClusterProposal = {
  ops: ["src/admin_tasks.py", "scripts/backfill.py"],
  api: ["src/api/routes.py", "src/api/middleware/rate_limiter.py"],
};

const oneLiners: Record<string, string> = {
  "src/admin_tasks.py": "Runs admin-only maintenance jobs.",
  "scripts/backfill.py": "One-off backfill script.",
  "src/api/routes.py": "Public API route handlers.",
  "src/api/middleware/rate_limiter.py": "Token-bucket rate limiter middleware.",
};

function fakeProvider(responses: object[]): Provider {
  let call = 0;
  return {
    name: "fake",
    model: "fake-model",
    interpret: vi.fn(async (): Promise<ProviderResult> => ({ text: JSON.stringify(responses[call++]), tokens: 10 })),
  };
}

describe("runPassC", () => {
  it("narrates each cluster with distinct what/how/when/where/why and confidence", async () => {
    const provider = fakeProvider([
      {
        what: "Groups operational scripts.",
        how: "Runs as standalone CLI entrypoints, not through the request path.",
        when: "Invoked manually or via cron, outside a request.",
        where: "Sits alongside the API layer but outside its call graph.",
        why: "Groups operational scripts that run outside the request path.",
        confidence: 0.8,
      },
      {
        what: "Handles public-facing HTTP traffic.",
        how: "Routes requests through middleware to handlers.",
        when: "On every inbound HTTP request.",
        where: "The system's front door.",
        why: "Handles all public-facing HTTP traffic.",
        confidence: 0.9,
      },
    ]);

    const result = await runPassC({ clusters, oneLiners, provider, promptRev: "p1" });

    expect(result.layers).toEqual([
      {
        name: "ops",
        files: clusters.ops,
        what: "Groups operational scripts.",
        how: "Runs as standalone CLI entrypoints, not through the request path.",
        when: "Invoked manually or via cron, outside a request.",
        where: "Sits alongside the API layer but outside its call graph.",
        why: "Groups operational scripts that run outside the request path.",
        confidence: 0.8,
        source: "llm",
      },
      {
        name: "api",
        files: clusters.api,
        what: "Handles public-facing HTTP traffic.",
        how: "Routes requests through middleware to handlers.",
        when: "On every inbound HTTP request.",
        where: "The system's front door.",
        why: "Handles all public-facing HTTP traffic.",
        confidence: 0.9,
        source: "llm",
      },
    ]);
  });

  it("calls the provider once per cluster, including that cluster's file summaries", async () => {
    const provider = fakeProvider([
      { what: "ops what", how: "ops how", when: "ops when", where: "ops where", why: "ops narration", confidence: 0.7 },
      { what: "api what", how: "api how", when: "api when", where: "api where", why: "api narration", confidence: 0.7 },
    ]);

    await runPassC({ clusters, oneLiners, provider, promptRev: "p1" });

    expect(provider.interpret).toHaveBeenCalledTimes(2);
    const firstCall = (provider.interpret as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(firstCall[0]).toContain("Runs admin-only maintenance jobs.");
    expect(firstCall[0]).toContain("One-off backfill script.");
  });

  it("throws a clear error when a cluster's response is invalid JSON", async () => {
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async () => ({ text: "not json", tokens: 1 })),
    };

    await expect(runPassC({ clusters, oneLiners, provider, promptRev: "p1" })).rejects.toThrow(/pass c/i);
  });
});

describe("runPassCGroups with merge-based design", () => {
  const layers = [
    { name: "ops", why: "Groups operational scripts that run outside the request path." },
    { name: "api", why: "Handles all public-facing HTTP traffic." },
    { name: "db", why: "Database schema and migrations." },
  ];

  function fakeProvider(response: object): Provider {
    return {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async (): Promise<ProviderResult> => ({ text: JSON.stringify(response), tokens: 10 })),
    };
  }

  it("creates singleton groups for layers not mentioned in any merge", async () => {
    const proposal = {
      merges: {
        platform: ["ops", "db"],
      },
    };
    const provider = fakeProvider(proposal);

    const result = await runPassCGroups({ layers, edges: [], provider, promptRev: "p1" });

    expect(result.groups.platform).toContain("ops");
    expect(result.groups.platform).toContain("db");
    expect(result.groups.api).toContain("api");
    expect(result.repaired).toBe(false);
  });

  it("partitions every layer exactly once, even when the LLM proposes no merges", async () => {
    const provider = fakeProvider({ merges: {} });

    const result = await runPassCGroups({ layers, edges: [], provider, promptRev: "p1" });

    const allLayers = Object.values(result.groups).flat().sort();
    expect(allLayers).toEqual(["api", "db", "ops"]);
    // Each layer should be its own singleton
    expect(result.groups.ops).toEqual(["ops"]);
    expect(result.groups.api).toEqual(["api"]);
    expect(result.groups.db).toEqual(["db"]);
  });

  it("reports repaired: false when all merges reference valid layers and no layers are missed", async () => {
    const proposal = {
      merges: {
        platform: ["ops", "db"],
      },
    };
    const provider = fakeProvider(proposal);

    const result = await runPassCGroups({ layers, edges: [], provider, promptRev: "p1" });

    expect(result.repaired).toBe(false);
  });

  it("drops layers from a merge that don't actually exist, and reports repaired: true", async () => {
    const proposal = {
      merges: {
        platform: ["ops", "db", "fake-layer"],
      },
    };
    const provider = fakeProvider(proposal);

    const result = await runPassCGroups({ layers, edges: [], provider, promptRev: "p1" });

    expect(result.repaired).toBe(true);
    expect(result.groups.platform).toContain("ops");
    expect(result.groups.platform).toContain("db");
    expect(result.groups.platform).not.toContain("fake-layer");
  });

  it("resolves conflicts when a layer appears in multiple merges, favoring the first merge", async () => {
    const proposal = {
      merges: {
        platform: ["ops", "db"],
        api_group: ["db"], // db appears twice — should be dropped from this merge
      },
    };
    const provider = fakeProvider(proposal);

    const result = await runPassCGroups({ layers, edges: [], provider, promptRev: "p1" });

    expect(result.repaired).toBe(true);
    // db should be in platform, not in api_group
    expect(result.groups.platform).toContain("db");
    expect(result.groups.api_group).toBeUndefined();
  });

  it("renames a merge whose name collides with a layer left unmerged, instead of dropping that layer's own group", async () => {
    const proposal = { merges: { db: ["ops", "api"] } };
    const provider = fakeProvider(proposal);

    const result = await runPassCGroups({ layers, edges: [], provider, promptRev: "p1" });

    expect(result.repaired).toBe(true);
    expect(result.groups.db).toEqual(["db"]);
    expect(result.groups.db_group).toEqual(expect.arrayContaining(["ops", "api"]));
    const allLayers = Object.values(result.groups).flat().sort();
    expect(allLayers).toEqual(["api", "db", "ops"]);
  });

  it("renames a merge whose name collides with one of its own merged layer names", async () => {
    const proposal = { merges: { ops: ["ops", "db"] } };
    const provider = fakeProvider(proposal);

    const result = await runPassCGroups({ layers, edges: [], provider, promptRev: "p1" });

    expect(result.repaired).toBe(true);
    expect(result.groups.ops_group).toEqual(expect.arrayContaining(["ops", "db"]));
    const allLayers = Object.values(result.groups).flat().sort();
    expect(allLayers).toEqual(["api", "db", "ops"]);
  });

  it("includes layer why-narration in the prompt sent to the provider", async () => {
    const provider = fakeProvider({ merges: {} });

    await runPassCGroups({
      layers,
      edges: [],
      provider,
      promptRev: "p1",
    });

    const call = (provider.interpret as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("Groups operational scripts that run outside the request path.");
    expect(call[0]).toContain("ops");
  });

  it("throws a clear error when the provider returns invalid JSON", async () => {
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async () => ({ text: "not json", tokens: 1 })),
    };

    await expect(runPassCGroups({ layers, edges: [], provider, promptRev: "p1" })).rejects.toThrow(/pass c/i);
  });

});

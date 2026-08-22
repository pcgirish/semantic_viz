import { describe, expect, it, vi } from "vitest";
import { runPassC, runPassCGroups } from "../src/pass-c.js";
import type { Layer } from "../src/pass-c.js";
import type { Provider, ProviderResult } from "../src/provider.js";
import { layerIdFor, type ClusterGroups } from "../src/cluster.js";

const opsFiles = ["scripts/backfill.py", "src/admin_tasks.py"];
const apiFiles = ["src/api/middleware/rate_limiter.py", "src/api/routes.py"];

/** Keyed by structural id, in the ascending-id order `clusterFiles` emits — Pass C names
 *  clusters, it no longer receives names. */
const groups: ClusterGroups = new Map(
  [
    [layerIdFor(opsFiles), opsFiles] as const,
    [layerIdFor(apiFiles), apiFiles] as const,
  ].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
);
const [firstFiles, secondFiles] = [...groups.values()];

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
        name: "first_cluster",
        what: "Groups operational scripts.",
        how: "Runs as standalone CLI entrypoints, not through the request path.",
        when: "Invoked manually or via cron, outside a request.",
        where: "Sits alongside the API layer but outside its call graph.",
        why: "Groups operational scripts that run outside the request path.",
        confidence: 0.8,
      },
      {
        name: "second_cluster",
        what: "Handles public-facing HTTP traffic.",
        how: "Routes requests through middleware to handlers.",
        when: "On every inbound HTTP request.",
        where: "The system's front door.",
        why: "Handles all public-facing HTTP traffic.",
        confidence: 0.9,
      },
    ]);

    const result = await runPassC({ groups, oneLiners, provider, promptRev: "p1" });

    expect(result.layers).toEqual([
      {
        name: "first_cluster",
        files: firstFiles,
        what: "Groups operational scripts.",
        how: "Runs as standalone CLI entrypoints, not through the request path.",
        when: "Invoked manually or via cron, outside a request.",
        where: "Sits alongside the API layer but outside its call graph.",
        why: "Groups operational scripts that run outside the request path.",
        confidence: 0.8,
        source: "llm",
      },
      {
        name: "second_cluster",
        files: secondFiles,
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
      { name: "ops", what: "ops what", how: "ops how", when: "ops when", where: "ops where", why: "ops narration", confidence: 0.7 },
      { name: "api", what: "api what", how: "api how", when: "api when", where: "api where", why: "api narration", confidence: 0.7 },
    ]);

    await runPassC({ groups, oneLiners, provider, promptRev: "p1" });

    expect(provider.interpret).toHaveBeenCalledTimes(2);
    const prompts = (provider.interpret as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    const opsPrompt = prompts.find((prompt) => prompt.includes("src/admin_tasks.py"));
    expect(opsPrompt).toContain("Runs admin-only maintenance jobs.");
    expect(opsPrompt).toContain("One-off backfill script.");
  });

  it("carries a predecessor layer over verbatim and makes no call for it — the id is a membership hash, so a hit means identical files", async () => {
    const previous: Layer = {
      name: "operational_scripts",
      files: [...opsFiles],
      what: "prev what",
      how: "prev how",
      when: "prev when",
      where: "prev where",
      why: "prev why",
      confidence: 0.42,
      source: "llm",
    };
    const provider = fakeProvider([
      { name: "other", what: "w", how: "h", when: "wh", where: "wr", why: "y", confidence: 0.5 },
    ]);

    const result = await runPassC({
      groups,
      oneLiners,
      provider,
      promptRev: "p1",
      previousLayers: new Map([[layerIdFor(opsFiles), previous]]),
    });

    // One cluster had a predecessor, so only the other one was asked about.
    expect(provider.interpret).toHaveBeenCalledTimes(1);
    const carried = result.layers.find((l) => l.name === "operational_scripts");
    expect(carried).toEqual(previous);
  });

  it("names a cluster whose membership changed, rather than carrying the old record over — a different file set is a different id", async () => {
    const previous: Layer = {
      name: "operational_scripts",
      files: ["scripts/backfill.py"],
      what: "prev what",
      how: "prev how",
      when: "prev when",
      where: "prev where",
      why: "prev why",
      confidence: 0.42,
      source: "llm",
    };
    const provider = fakeProvider([
      { name: "one", what: "w", how: "h", when: "wh", where: "wr", why: "y", confidence: 0.5 },
      { name: "two", what: "w", how: "h", when: "wh", where: "wr", why: "y", confidence: 0.5 },
    ]);

    await runPassC({
      groups,
      oneLiners,
      provider,
      promptRev: "p1",
      previousLayers: new Map([[layerIdFor(previous.files), previous]]),
    });

    expect(provider.interpret).toHaveBeenCalledTimes(2);
  });

  it("throws a clear error when a cluster's response is invalid JSON", async () => {
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async () => ({ text: "not json", tokens: 1 })),
    };

    await expect(runPassC({ groups, oneLiners, provider, promptRev: "p1" })).rejects.toThrow(/pass c/i);
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

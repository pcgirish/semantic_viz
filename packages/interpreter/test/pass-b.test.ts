import { describe, expect, it, vi } from "vitest";
import { runPassB } from "../src/pass-b.js";
import type { Provider, ProviderResult } from "../src/provider.js";
import type { ImportEdge } from "../src/checker.js";

const files = ["src/admin_tasks.py", "scripts/backfill.py", "src/api/routes.py", "src/api/middleware/rate_limiter.py"];

const oneLiners: Record<string, string> = {
  "src/admin_tasks.py": "Runs admin-only maintenance jobs.",
  "scripts/backfill.py": "One-off backfill script.",
  "src/api/routes.py": "Public API route handlers.",
  "src/api/middleware/rate_limiter.py": "Token-bucket rate limiter middleware.",
};

const edges: ImportEdge[] = [
  { from: "src/admin_tasks.py", to: "scripts/backfill.py", weight: 1 },
  { from: "src/api/routes.py", to: "src/api/middleware/rate_limiter.py", weight: 1 },
];

function fakeProvider(response: object): Provider {
  return {
    name: "fake",
    model: "fake-model",
    interpret: vi.fn(async (): Promise<ProviderResult> => ({ text: JSON.stringify(response), tokens: 10 })),
  };
}

describe("runPassB with merge-based design", () => {
  it("creates singleton clusters for directories not mentioned in any merge", async () => {
    // Only merge src and scripts; src/api and src/api/middleware stay as singletons
    const proposal = {
      merges: {
        ops: ["src", "scripts"],
      },
    };
    const provider = fakeProvider(proposal);

    const result = await runPassB({ files, oneLiners, edges, provider, promptRev: "p1" });

    // ops should contain src and scripts files
    expect(result.clusters.ops).toContain("src/admin_tasks.py");
    expect(result.clusters.ops).toContain("scripts/backfill.py");
    // src/api and src/api/middleware are their own singletons
    expect(result.clusters["src/api"]).toContain("src/api/routes.py");
    expect(result.clusters["src/api/middleware"]).toContain("src/api/middleware/rate_limiter.py");
    expect(result.repaired).toBe(false);
  });

  it("partitions every file exactly once, even when the LLM proposes no merges", async () => {
    const provider = fakeProvider({ merges: {} });

    const result = await runPassB({ files, oneLiners, edges, provider, promptRev: "p1" });

    const allFiles = Object.values(result.clusters).flat().sort();
    expect(allFiles).toEqual([...files].sort());
    // Each directory should be its own singleton
    expect(Object.keys(result.clusters)).toContain("src");
    expect(Object.keys(result.clusters)).toContain("scripts");
    expect(Object.keys(result.clusters)).toContain("src/api");
    expect(Object.keys(result.clusters)).toContain("src/api/middleware");
  });

  it("drops directories from a merge that don't actually exist, and reports repaired: true", async () => {
    const proposal = {
      merges: {
        ops: ["src", "scripts", "fake-dir"],
      },
    };
    const provider = fakeProvider(proposal);

    const result = await runPassB({ files, oneLiners, edges, provider, promptRev: "p1" });

    expect(result.repaired).toBe(true);
    expect(result.clusters.ops).toContain("src/admin_tasks.py");
    expect(result.clusters.ops).toContain("scripts/backfill.py");
    // fake-dir doesn't exist, so it's dropped
  });

  it("resolves conflicts when a directory appears in multiple merges, favoring the first merge", async () => {
    const proposal = {
      merges: {
        ops: ["src", "scripts"],
        api_layer: ["src"], // src appears twice — should be dropped from this merge
      },
    };
    const provider = fakeProvider(proposal);

    const result = await runPassB({ files, oneLiners, edges, provider, promptRev: "p1" });

    expect(result.repaired).toBe(true);
    // src should be in ops, not in api_layer
    expect(result.clusters.ops).toContain("src/admin_tasks.py");
    expect(result.clusters.api_layer).toBeUndefined();
  });

  it("reports modularity for both the proposed clustering and the directory baseline", async () => {
    const proposal = {
      merges: {
        ops: ["src", "scripts"],
      },
    };
    const provider = fakeProvider(proposal);

    const result = await runPassB({ files, oneLiners, edges, provider, promptRev: "p1" });

    expect(typeof result.modularity).toBe("number");
    expect(typeof result.directoryModularity).toBe("number");
  });

  it("renames a merge whose name collides with a directory left unmerged, instead of dropping that directory's files", async () => {
    // "src/api" and "src/api/middleware" are merged under the name "scripts" — but "scripts"
    // is itself a real, unmerged base directory. Without a rename, the singleton pass for
    // "scripts" would silently overwrite the merge's entry and drop its files.
    const proposal = { merges: { scripts: ["src/api", "src/api/middleware"] } };
    const provider = fakeProvider(proposal);

    const result = await runPassB({ files, oneLiners, edges, provider, promptRev: "p1" });

    expect(result.repaired).toBe(true);
    expect(result.clusters.scripts).toEqual(["scripts/backfill.py"]);
    expect(result.clusters.scripts_group).toEqual(expect.arrayContaining(["src/api/routes.py", "src/api/middleware/rate_limiter.py"]));
    const allFiles = Object.values(result.clusters).flat();
    expect(allFiles.sort()).toEqual([...files].sort());
  });

  it("renames a merge whose name collides with one of its own merged directory names", async () => {
    const proposal = { merges: { src: ["src", "scripts"] } };
    const provider = fakeProvider(proposal);

    const result = await runPassB({ files, oneLiners, edges, provider, promptRev: "p1" });

    expect(result.repaired).toBe(true);
    expect(result.clusters.src_group).toEqual(expect.arrayContaining(["src/admin_tasks.py", "scripts/backfill.py"]));
    const allFiles = Object.values(result.clusters).flat();
    expect(allFiles.sort()).toEqual([...files].sort());
  });

  it("includes directory summaries and edges in the prompt sent to the provider", async () => {
    const provider = fakeProvider({ merges: {} });

    await runPassB({ files, oneLiners, edges, provider, promptRev: "p1" });

    const call = (provider.interpret as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("Base directories");
  });

  it("throws a clear error when the provider returns invalid JSON", async () => {
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async () => ({ text: "not json", tokens: 1 })),
    };

    await expect(runPassB({ files, oneLiners, edges, provider, promptRev: "p1" })).rejects.toThrow(/pass b/i);
  });

  it("derives directory edges from file edges by aggregating", async () => {
    const provider = fakeProvider({ merges: {} });

    await runPassB({ files, oneLiners, edges, provider, promptRev: "p1" });

    const call = (provider.interpret as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("->");
  });

  it("partitions all files into directory singletons when the response has no merges key at all", async () => {
    const provider = fakeProvider({});

    const result = await runPassB({ files, oneLiners, edges, provider, promptRev: "p1" });

    const allFiles = Object.values(result.clusters).flat().sort();
    expect(allFiles).toEqual([...files].sort());
  });
});

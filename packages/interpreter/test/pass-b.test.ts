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

describe("runPassB", () => {
  it("returns the LLM's proposed clusters when they already partition every file", async () => {
    const proposal = {
      ops: ["src/admin_tasks.py", "scripts/backfill.py"],
      api: ["src/api/routes.py", "src/api/middleware/rate_limiter.py"],
    };
    const provider = fakeProvider({ clusters: proposal });

    const result = await runPassB({ files, oneLiners, edges, provider, promptRev: "p1" });

    expect(result.clusters).toEqual(proposal);
    expect(result.repaired).toBe(false);
  });

  it("groups admin_tasks with scripts by import cohesion, not by directory", async () => {
    const proposal = {
      ops: ["src/admin_tasks.py", "scripts/backfill.py"],
      api: ["src/api/routes.py", "src/api/middleware/rate_limiter.py"],
    };
    const provider = fakeProvider({ clusters: proposal });

    const result = await runPassB({ files, oneLiners, edges, provider, promptRev: "p1" });

    expect(result.clusters.ops).toEqual(expect.arrayContaining(["src/admin_tasks.py", "scripts/backfill.py"]));
  });

  it("reports modularity for both the proposed clustering and the directory baseline", async () => {
    const proposal = {
      ops: ["src/admin_tasks.py", "scripts/backfill.py"],
      api: ["src/api/routes.py", "src/api/middleware/rate_limiter.py"],
    };
    const provider = fakeProvider({ clusters: proposal });

    const result = await runPassB({ files, oneLiners, edges, provider, promptRev: "p1" });

    expect(result.modularity).toBe(1);
    expect(result.directoryModularity).toBeLessThan(result.modularity);
  });

  it("repairs a proposal that omits a file, and reports repaired: true", async () => {
    const provider = fakeProvider({ clusters: { ops: ["src/admin_tasks.py"] } });

    const result = await runPassB({ files, oneLiners, edges, provider, promptRev: "p1" });

    expect(result.repaired).toBe(true);
    const allFiles = Object.values(result.clusters).flat();
    expect(allFiles.sort()).toEqual([...files].sort());
  });

  it("includes the one-liners and import edges in the prompt sent to the provider", async () => {
    const provider = fakeProvider({ clusters: { ops: files } });

    await runPassB({ files, oneLiners, edges, provider, promptRev: "p1" });

    const call = (provider.interpret as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("Runs admin-only maintenance jobs.");
    expect(call[0]).toContain("src/admin_tasks.py -> scripts/backfill.py");
  });

  it("accepts a response that omits the \"clusters\" wrapper and returns the cluster map directly at the root — some local models drop it despite the prompt asking for it", async () => {
    const proposal = {
      ops: ["src/admin_tasks.py", "scripts/backfill.py"],
      api: ["src/api/routes.py", "src/api/middleware/rate_limiter.py"],
    };
    const provider = fakeProvider(proposal);

    const result = await runPassB({ files, oneLiners, edges, provider, promptRev: "p1" });

    expect(result.clusters).toEqual(proposal);
  });

  it("throws a clear error when the provider returns invalid JSON", async () => {
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async () => ({ text: "not json", tokens: 1 })),
    };

    await expect(runPassB({ files, oneLiners, edges, provider, promptRev: "p1" })).rejects.toThrow(/pass b/i);
  });
});

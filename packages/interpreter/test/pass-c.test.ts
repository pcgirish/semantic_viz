import { describe, expect, it, vi } from "vitest";
import { runPassC } from "../src/pass-c.js";
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
  it("narrates each cluster with a name, why, and confidence", async () => {
    const provider = fakeProvider([
      { why: "Groups operational scripts that run outside the request path.", confidence: 0.8 },
      { why: "Handles all public-facing HTTP traffic.", confidence: 0.9 },
    ]);

    const result = await runPassC({ clusters, oneLiners, provider, promptRev: "p1" });

    expect(result.layers).toEqual([
      { name: "ops", files: clusters.ops, why: "Groups operational scripts that run outside the request path.", confidence: 0.8, source: "llm" },
      { name: "api", files: clusters.api, why: "Handles all public-facing HTTP traffic.", confidence: 0.9, source: "llm" },
    ]);
  });

  it("calls the provider once per cluster, including that cluster's file summaries", async () => {
    const provider = fakeProvider([
      { why: "ops narration", confidence: 0.7 },
      { why: "api narration", confidence: 0.7 },
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

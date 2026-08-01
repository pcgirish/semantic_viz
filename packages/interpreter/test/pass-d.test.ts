import { describe, expect, it, vi } from "vitest";
import { runPassD } from "../src/pass-d.js";
import type { Provider, ProviderResult } from "../src/provider.js";
import type { PassDContext } from "../src/prompts/pass-d.js";

const context: PassDContext = {
  qualname: "src.api.middleware.rate_limiter",
  status: "added",
  what: "Limits requests per API token using a Redis-backed token bucket.",
  why: "Prevents abuse of the public API.",
  blastRadius: { direct: 2, transitive: 5, public_api: true },
  amount: 1,
};

function fakeProvider(response: object): Provider {
  return {
    name: "fake",
    model: "fake-model",
    interpret: vi.fn(async (): Promise<ProviderResult> => ({ text: JSON.stringify(response), tokens: 10 })),
  };
}

describe("runPassD", () => {
  it("returns five risk axes, why, and confidence, with score as the max axis", async () => {
    const provider = fakeProvider({
      axes: { functionality: 0.4, availability: 0.95, scalability: 0.3, performance: 0.2, security: 0.5 },
      why: "Unguarded Redis dependency in the request path with no fallback.",
      confidence: 0.78,
    });

    const result = await runPassD({ context, provider, promptRev: "p1" });

    expect(result.axes).toEqual({ functionality: 0.4, availability: 0.95, scalability: 0.3, performance: 0.2, security: 0.5 });
    expect(result.score).toBe(0.95);
    expect(result.why).toContain("Unguarded Redis");
    expect(result.confidence).toBe(0.78);
    expect(result.source).toBe("llm");
  });

  it("includes the unit's qualname, blast radius, and change magnitude in the prompt", async () => {
    const provider = fakeProvider({
      axes: { functionality: 0.1, availability: 0.1, scalability: 0.1, performance: 0.1, security: 0.1 },
      why: "low risk",
      confidence: 0.9,
    });

    await runPassD({ context, provider, promptRev: "p1" });

    const call = (provider.interpret as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("src.api.middleware.rate_limiter");
    expect(call[0]).toContain("2 direct callers");
    expect(call[0]).toContain("public API: true");
  });

  it("throws a clear error when the provider returns invalid JSON", async () => {
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async () => ({ text: "not json", tokens: 1 })),
    };

    await expect(runPassD({ context, provider, promptRev: "p1" })).rejects.toThrow(/pass d/i);
  });
});

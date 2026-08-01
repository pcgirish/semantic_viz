import { describe, expect, it, vi } from "vitest";
import { rankInspectQueue } from "../src/rank.js";
import type { Provider, ProviderResult } from "../src/provider.js";
import type { RankCandidate } from "../src/prompts/rank.js";

const candidates: RankCandidate[] = [
  { unit: "u:1", qualname: "n1", status: "modified", score: 0.6, confidence: 0.82, blastRadius: { direct: 1, transitive: 2, public_api: true }, why: "public contract changed" },
  { unit: "u:2", qualname: "n2", status: "modified", score: 0.25, confidence: 0.55, blastRadius: { direct: 0, transitive: 0, public_api: false }, why: "low confidence, unobservable blast radius" },
];

function fakeProvider(response: object): Provider {
  return {
    name: "fake",
    model: "fake-model",
    interpret: vi.fn(async (): Promise<ProviderResult> => ({ text: JSON.stringify(response), tokens: 10 })),
  };
}

describe("rankInspectQueue", () => {
  it("returns candidates re-ordered per the LLM's ranked unit id list", async () => {
    const provider = fakeProvider({ ranked: ["u:2", "u:1"] });

    const result = await rankInspectQueue({ candidates, provider, promptRev: "p1" });

    expect(result.map((r) => r.unit)).toEqual(["u:2", "u:1"]);
    expect(result[0]).toMatchObject({ rank: 1, unit: "u:2" });
    expect(result[1]).toMatchObject({ rank: 2, unit: "u:1" });
  });

  it("returns an empty queue without calling the provider when there are no candidates", async () => {
    const provider = fakeProvider({ ranked: [] });

    const result = await rankInspectQueue({ candidates: [], provider, promptRev: "p1" });

    expect(result).toEqual([]);
    expect(provider.interpret).not.toHaveBeenCalled();
  });

  it("throws a clear error when the LLM omits or invents a unit id", async () => {
    const provider = fakeProvider({ ranked: ["u:1"] });

    await expect(rankInspectQueue({ candidates, provider, promptRev: "p1" })).rejects.toThrow(/rank/i);
  });

  it("throws a clear error when the provider returns invalid JSON", async () => {
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async () => ({ text: "not json", tokens: 1 })),
    };

    await expect(rankInspectQueue({ candidates, provider, promptRev: "p1" })).rejects.toThrow(/rank/i);
  });
});

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
  it("returns candidates re-ordered per the LLM's ranked 1-indexed position list", async () => {
    // candidate #1 is u:1, #2 is u:2 — ranked [2, 1] means "u:2 first, then u:1"
    const provider = fakeProvider({ ranked: [2, 1] });

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

  it("throws a clear error when the LLM omits or invents a position", async () => {
    const provider = fakeProvider({ ranked: [1] });

    await expect(rankInspectQueue({ candidates, provider, promptRev: "p1" })).rejects.toThrow(/rank/i);
  });

  it("throws a clear error when the LLM returns a position out of range", async () => {
    const provider = fakeProvider({ ranked: [1, 99] });

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

  it("falls back to sorting by risk score, without calling the provider, when candidates exceed the LLM ranking cap", async () => {
    const many: RankCandidate[] = Array.from({ length: 31 }, (_, i) => ({
      unit: `u:${i}`,
      qualname: `n${i}`,
      status: "modified",
      score: i / 31,
      confidence: 0.8,
      blastRadius: { direct: 0, transitive: 0, public_api: false },
      why: "",
    }));
    const provider = fakeProvider({ ranked: [] });

    const result = await rankInspectQueue({ candidates: many, provider, promptRev: "p1" });

    expect(provider.interpret).not.toHaveBeenCalled();
    expect(result.map((r) => r.unit)).toEqual(["u:30", "u:29", "u:28"].concat(result.slice(3).map((r) => r.unit)));
    expect(result[0]!.rank).toBe(1);
    expect(result).toHaveLength(31);
    // strictly descending by score
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.score).toBeLessThanOrEqual(result[i - 1]!.score);
    }
  });

  it("still uses the LLM ranking when candidates are at or under the cap", async () => {
    const thirty: RankCandidate[] = Array.from({ length: 30 }, (_, i) => ({
      unit: `u:${i}`,
      qualname: `n${i}`,
      status: "modified",
      score: 0.5,
      confidence: 0.8,
      blastRadius: { direct: 0, transitive: 0, public_api: false },
      why: "",
    }));
    const reversed = Array.from({ length: 30 }, (_, i) => 30 - i);
    const provider = fakeProvider({ ranked: reversed });

    const result = await rankInspectQueue({ candidates: thirty, provider, promptRev: "p1" });

    expect(provider.interpret).toHaveBeenCalledTimes(1);
    expect(result[0]!.unit).toBe("u:29");
  });
});

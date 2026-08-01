import { describe, expect, it, vi } from "vitest";
import { runPassA } from "../src/pass-a.js";
import type { Provider, ProviderResult } from "../src/provider.js";
import type { SymbolUnit } from "@scv/extractor";

function makeUnit(overrides: Partial<SymbolUnit> = {}): SymbolUnit {
  return {
    id: "u:py:src.rate_limiter.check#f",
    kind: "function",
    name: "check",
    qualname: "src.rate_limiter.check",
    lang: "python",
    parent: null,
    children: [],
    loc: { file: "src/rate_limiter.py", start: 1, end: 7 },
    sloc: 6,
    params: [{ name: "user_id", type: null }],
    returns: "bool",
    bases: [],
    hash: { struct: "s1", text: "t1" },
    metrics: { fanIn: 0, fanOut: 1, churn: 0, commits: 1 },
    authors: [],
    ...overrides,
  };
}

function fakeProvider(response: object): Provider {
  return {
    name: "fake",
    model: "fake-model",
    interpret: vi.fn(async (): Promise<ProviderResult> => ({ text: JSON.stringify(response), tokens: 42 })),
  };
}

const validResponse = {
  what: "Checks a per-user rate limit",
  how: "Increments a redis counter and compares to a limit",
  when: "On every incoming request",
  where: "src/rate_limiter.py",
  why: "Protects downstream services from abuse",
  confidence: 0.9,
  ports: { in: [{ name: "user_id", type: "str", description: "the caller's id" }], out: [] },
  cost: { complexity: 2, io: ["redis"], estimate: "one redis round-trip", confidence: 0.8 },
  tags: ["hot-path"],
};

describe("runPassA", () => {
  it("builds semantics/cost/tags from the provider's JSON response", async () => {
    const provider = fakeProvider(validResponse);
    const unit = makeUnit();

    const result = await runPassA({ unit, source: "def check(user_id): ...", provider, promptRev: "p1" });

    expect(result.semantics).toEqual({
      what: validResponse.what,
      how: validResponse.how,
      when: validResponse.when,
      where: validResponse.where,
      why: validResponse.why,
      confidence: 0.9,
      source: "llm",
    });
    expect(result.cost).toEqual({
      complexity: 2,
      io: ["redis"],
      estimate: "one redis round-trip",
      confidence: 0.8,
      source: "llm",
    });
    expect(result.tags).toEqual(["hot-path"]);
  });

  it("passes the unit's source and qualname to the provider", async () => {
    const provider = fakeProvider(validResponse);
    const unit = makeUnit({ qualname: "src.rate_limiter.check" });

    await runPassA({ unit, source: "def check(user_id): ...", provider, promptRev: "p1" });

    const call = (provider.interpret as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("def check(user_id): ...");
    expect(call[0]).toContain("src.rate_limiter.check");
  });

  it("strips a markdown code fence some models wrap JSON in despite instructions", async () => {
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async () => ({
        text: "```json\n" + JSON.stringify(validResponse) + "\n```",
        tokens: 42,
      })),
    };
    const unit = makeUnit();

    const result = await runPassA({ unit, source: "def check(): ...", provider, promptRev: "p1" });
    expect(result.semantics.what).toBe(validResponse.what);
  });

  it("throws a clear error when the provider returns invalid JSON", async () => {
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async () => ({ text: "not json", tokens: 1 })),
    };
    const unit = makeUnit();

    await expect(
      runPassA({ unit, source: "def check(): ...", provider, promptRev: "p1" }),
    ).rejects.toThrow(/pass a/i);
  });

  it("throws when the provider's JSON is missing required fields", async () => {
    const provider = fakeProvider({ what: "only this field" });
    const unit = makeUnit();

    await expect(
      runPassA({ unit, source: "def check(): ...", provider, promptRev: "p1" }),
    ).rejects.toThrow();
  });
});

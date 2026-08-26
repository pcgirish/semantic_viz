import { describe, expect, it, vi } from "vitest";
import { interpretJsonWithRetry } from "../src/retry.js";
import type { Provider, ProviderResult } from "../src/provider.js";
import { z } from "zod";

const Schema = z.object({ a: z.number() });

function providerReturning(...texts: string[]): Provider {
  let call = 0;
  return {
    name: "fake",
    model: "fake-model",
    interpret: vi.fn(async (): Promise<ProviderResult> => ({ text: texts[call++]!, tokens: 5 })),
  };
}

describe("interpretJsonWithRetry", () => {
  it("returns the parsed+validated result on the first successful call", async () => {
    const provider = providerReturning('{"a":1}');

    const result = await interpretJsonWithRetry({ provider, prompt: "p", label: "test", schema: Schema });

    expect(result).toEqual({ a: 1 });
    expect(provider.interpret).toHaveBeenCalledTimes(1);
  });

  it("retries once on malformed JSON and succeeds on the second attempt", async () => {
    const provider = providerReturning('{"a": bad syntax', '{"a":2}');

    const result = await interpretJsonWithRetry({ provider, prompt: "p", label: "test", schema: Schema });

    expect(result).toEqual({ a: 2 });
    expect(provider.interpret).toHaveBeenCalledTimes(2);
  });

  it("retries on a response that parses but fails schema validation", async () => {
    const provider = providerReturning('{"a":"not a number"}', '{"a":3}');

    const result = await interpretJsonWithRetry({ provider, prompt: "p", label: "test", schema: Schema });

    expect(result).toEqual({ a: 3 });
    expect(provider.interpret).toHaveBeenCalledTimes(2);
  });

  it("throws the labeled error after exhausting retries", async () => {
    const provider = providerReturning("not json", "still not json", "nope");

    await expect(
      interpretJsonWithRetry({ provider, prompt: "p", label: "test", schema: Schema, maxAttempts: 3 }),
    ).rejects.toThrow(/test/i);
    expect(provider.interpret).toHaveBeenCalledTimes(3);
  });

  it("defaults to 2 attempts", async () => {
    const provider = providerReturning("not json", "still not json");

    await expect(interpretJsonWithRetry({ provider, prompt: "p", label: "test", schema: Schema })).rejects.toThrow();
    expect(provider.interpret).toHaveBeenCalledTimes(2);
  });
});

import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { interpretJsonWithRetry } from "../src/retry.js";
import { ContentCache } from "../src/cache.js";
import { CachedProvider } from "../src/cached-provider.js";
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
  // Test 12 — write side, end to end through a real CachedProvider: a bad first response must
  // leave no cache row behind, or the retry re-reads it and the unit fails permanently.
  it("leaves no unparseable row in the cache when a bad response is retried successfully", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "scv-retry-cache-"));
    const cache = new ContentCache(path.join(dir, "cache.sqlite"));
    const inner = providerReturning('{"a": bad syntax', '{"a":2}');
    const provider = new CachedProvider(inner, cache, "p1");

    const result = await interpretJsonWithRetry({ provider, prompt: "p", label: "test", schema: Schema });

    expect(result).toEqual({ a: 2 });
    expect(inner.interpret).toHaveBeenCalledTimes(2);

    const db = new Database(path.join(dir, "cache.sqlite"));
    const texts = (db.prepare("SELECT text FROM cache").all() as { text: string }[]).map((r) => r.text);
    db.close();
    for (const text of texts) expect(() => JSON.parse(text)).not.toThrow();

    cache.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("supplies a validate that also rejects a schema-invalid response, so it is never cached", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "scv-retry-cache-schema-"));
    const cache = new ContentCache(path.join(dir, "cache.sqlite"));
    const inner = providerReturning('{"a":"not a number"}', '{"a":3}');
    const provider = new CachedProvider(inner, cache, "p1");

    await interpretJsonWithRetry({ provider, prompt: "p", label: "test", schema: Schema });

    const db = new Database(path.join(dir, "cache.sqlite"));
    const rows = db.prepare("SELECT text FROM cache").all() as { text: string }[];
    db.close();
    expect(rows.map((r) => r.text)).toEqual(['{"a":3}']);

    cache.close();
    rmSync(dir, { recursive: true, force: true });
  });

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

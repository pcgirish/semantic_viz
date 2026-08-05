import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ContentCache } from "../src/cache.js";

describe("ContentCache", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "scv-interp-cache-"));
    dbPath = path.join(dir, "cache.sqlite");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const key = { inputHash: "abc123", promptRev: "p1", provider: "ollama", model: "qwen3.5:0.8b-mlx" };

  it("returns undefined on a miss", () => {
    const cache = new ContentCache(dbPath);
    expect(cache.get(key)).toBeUndefined();
    cache.close();
  });

  it("returns what was set, on a hit", () => {
    const cache = new ContentCache(dbPath);
    cache.set(key, { text: "does a thing", tokens: 12 });
    expect(cache.get(key)).toEqual({ text: "does a thing", tokens: 12 });
    cache.close();
  });

  it("misses when input_hash changes", () => {
    const cache = new ContentCache(dbPath);
    cache.set(key, { text: "does a thing", tokens: 12 });
    expect(cache.get({ ...key, inputHash: "different" })).toBeUndefined();
    cache.close();
  });

  it("misses when prompt_rev changes — a prompt edit invalidates exactly its own results", () => {
    const cache = new ContentCache(dbPath);
    cache.set(key, { text: "does a thing", tokens: 12 });
    expect(cache.get({ ...key, promptRev: "p2" })).toBeUndefined();
    cache.close();
  });

  it("misses when provider or model changes — no cross-provider staleness", () => {
    const cache = new ContentCache(dbPath);
    cache.set(key, { text: "does a thing", tokens: 12 });
    expect(cache.get({ ...key, provider: "anthropic" })).toBeUndefined();
    expect(cache.get({ ...key, model: "other-model" })).toBeUndefined();
    cache.close();
  });

  it("persists across instances backed by the same file", () => {
    const first = new ContentCache(dbPath);
    first.set(key, { text: "does a thing", tokens: 12 });
    first.close();

    const second = new ContentCache(dbPath);
    expect(second.get(key)).toEqual({ text: "does a thing", tokens: 12 });
    second.close();
  });

  describe("logCall / listCalls", () => {
    it("records a per-call row and returns it via listCalls", () => {
      const cache = new ContentCache(dbPath);
      cache.logCall({
        pass: "A",
        unitId: "u:py:mod.run#f",
        qualname: "mod.run",
        file: "mod.py",
        inTokens: 100,
        outTokens: 20,
        cacheHit: false,
        durationMs: 450,
      });

      const calls = cache.listCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        pass: "A",
        unitId: "u:py:mod.run#f",
        qualname: "mod.run",
        file: "mod.py",
        inTokens: 100,
        outTokens: 20,
        cacheHit: false,
        durationMs: 450,
      });
      expect(calls[0]!.ts).toBeTruthy();
      cache.close();
    });

    it("records cache hits with zero new tokens", () => {
      const cache = new ContentCache(dbPath);
      cache.logCall({ pass: "A", unitId: "u:1", qualname: "a", file: "a.py", inTokens: 0, outTokens: 0, cacheHit: true, durationMs: 0 });

      const calls = cache.listCalls();
      expect(calls[0]!.cacheHit).toBe(true);
      expect(calls[0]!.inTokens).toBe(0);
      expect(calls[0]!.outTokens).toBe(0);
      cache.close();
    });

    it("allows a call with no unit context (Pass B/C)", () => {
      const cache = new ContentCache(dbPath);
      cache.logCall({ pass: "B", inTokens: 50, outTokens: 10, cacheHit: false, durationMs: 0 });

      const calls = cache.listCalls();
      expect(calls[0]!.pass).toBe("B");
      expect(calls[0]!.unitId).toBeUndefined();
      cache.close();
    });

    it("persists logged calls across instances backed by the same file", () => {
      const first = new ContentCache(dbPath);
      first.logCall({ pass: "A", unitId: "u:1", qualname: "a", file: "a.py", inTokens: 5, outTokens: 5, cacheHit: false, durationMs: 0 });
      first.close();

      const second = new ContentCache(dbPath);
      expect(second.listCalls()).toHaveLength(1);
      second.close();
    });
  });
});

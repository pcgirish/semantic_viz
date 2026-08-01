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
});

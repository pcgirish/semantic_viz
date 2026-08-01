import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ContentCache } from "../src/cache.js";
import { CachedProvider } from "../src/cached-provider.js";
import type { Provider, ProviderResult } from "../src/provider.js";

describe("CachedProvider", () => {
  let dir: string;
  let cache: ContentCache;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "scv-cached-provider-"));
    cache = new ContentCache(path.join(dir, "cache.sqlite"));
  });

  afterEach(() => {
    cache.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function fakeProvider(): Provider {
    return {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async (): Promise<ProviderResult> => ({ text: "fresh result", tokens: 42 })),
    };
  }

  it("calls the underlying provider on a cache miss and stores the result", async () => {
    const inner = fakeProvider();
    const provider = new CachedProvider(inner, cache, "p1");

    const result = await provider.interpret("some prompt");

    expect(result).toEqual({ text: "fresh result", tokens: 42 });
    expect(inner.interpret).toHaveBeenCalledTimes(1);
  });

  it("returns the cached result without calling the underlying provider on a repeat prompt", async () => {
    const inner = fakeProvider();
    const provider = new CachedProvider(inner, cache, "p1");

    await provider.interpret("some prompt");
    const second = await provider.interpret("some prompt");

    expect(second).toEqual({ text: "fresh result", tokens: 42 });
    expect(inner.interpret).toHaveBeenCalledTimes(1);
  });

  it("misses when the prompt text differs — this is what makes it correct across snapshots", async () => {
    const inner = fakeProvider();
    const provider = new CachedProvider(inner, cache, "p1");

    await provider.interpret("prompt A");
    await provider.interpret("prompt B");

    expect(inner.interpret).toHaveBeenCalledTimes(2);
  });

  it("shares a cache hit across two CachedProvider instances backed by the same cache and promptRev", async () => {
    const inner1 = fakeProvider();
    const provider1 = new CachedProvider(inner1, cache, "p1");
    await provider1.interpret("some prompt");

    const inner2 = fakeProvider();
    const provider2 = new CachedProvider(inner2, cache, "p1");
    const result = await provider2.interpret("some prompt");

    expect(result).toEqual({ text: "fresh result", tokens: 42 });
    expect(inner2.interpret).not.toHaveBeenCalled();
  });

  it("exposes the underlying provider's name and model", () => {
    const inner = fakeProvider();
    const provider = new CachedProvider(inner, cache, "p1");

    expect(provider.name).toBe("fake");
    expect(provider.model).toBe("fake-model");
  });
});

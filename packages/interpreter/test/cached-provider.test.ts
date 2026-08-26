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

  it("misses when cacheKeyExtra differs even though the prompt text is identical — lets a caller's key track a callee's semantics digest without embedding it in the prompt", async () => {
    const inner = fakeProvider();
    const provider = new CachedProvider(inner, cache, "p1");

    await provider.interpret("some prompt", { cacheKeyExtra: "digest-1" });
    await provider.interpret("some prompt", { cacheKeyExtra: "digest-2" });

    expect(inner.interpret).toHaveBeenCalledTimes(2);
  });

  it("never forwards cacheKeyExtra to the underlying provider", async () => {
    const inner = fakeProvider();
    const provider = new CachedProvider(inner, cache, "p1");

    await provider.interpret("some prompt", { system: "sys", cacheKeyExtra: "digest-1" });

    const call = (inner.interpret as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toEqual({ system: "sys" });
  });

  it("logs a per-call row on a cache miss, carrying callMeta and token counts", async () => {
    const inner = {
      ...fakeProvider(),
      interpret: vi.fn(async (): Promise<ProviderResult> => ({ text: "fresh", tokens: 30, inputTokens: 20, outputTokens: 10 })),
    };
    const provider = new CachedProvider(inner, cache, "p1");

    await provider.interpret("some prompt", { callMeta: { pass: "A", unitId: "u:1", qualname: "mod.run", file: "mod.py" } });

    const calls = cache.listCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      pass: "A",
      unitId: "u:1",
      qualname: "mod.run",
      file: "mod.py",
      inTokens: 20,
      outTokens: 10,
      cacheHit: false,
    });
  });

  it("logs a cache-hit row with zero new tokens on a repeat call", async () => {
    const inner = {
      ...fakeProvider(),
      interpret: vi.fn(async (): Promise<ProviderResult> => ({ text: "fresh", tokens: 30, inputTokens: 20, outputTokens: 10 })),
    };
    const provider = new CachedProvider(inner, cache, "p1");

    await provider.interpret("some prompt", { callMeta: { pass: "A" } });
    await provider.interpret("some prompt", { callMeta: { pass: "A" } });

    const calls = cache.listCalls();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ cacheHit: true, inTokens: 0, outTokens: 0 });
  });

  it("does not fold callMeta into the cache key — identical prompts from different call sites still share a hit", async () => {
    const inner = fakeProvider();
    const provider = new CachedProvider(inner, cache, "p1");

    await provider.interpret("some prompt", { callMeta: { pass: "A", unitId: "u:1" } });
    await provider.interpret("some prompt", { callMeta: { pass: "A", unitId: "u:2" } });

    expect(inner.interpret).toHaveBeenCalledTimes(1);
  });

  it("never forwards callMeta to the underlying provider", async () => {
    const inner = fakeProvider();
    const provider = new CachedProvider(inner, cache, "p1");

    await provider.interpret("some prompt", { system: "sys", callMeta: { pass: "A", unitId: "u:1" } });

    const call = (inner.interpret as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toEqual({ system: "sys" });
  });

  it("exposes the underlying provider's name and model", () => {
    const inner = fakeProvider();
    const provider = new CachedProvider(inner, cache, "p1");

    expect(provider.name).toBe("fake");
    expect(provider.model).toBe("fake-model");
  });

  it("reports input/output usage and does not charge tokens for cache hits", async () => {
    const inner = {
      ...fakeProvider(),
      interpret: vi.fn(async (): Promise<ProviderResult> => ({
        text: "fresh result",
        tokens: 42,
        inputTokens: 30,
        outputTokens: 12,
      })),
    };
    const provider = new CachedProvider(inner, cache, "p1");

    await provider.interpret("some prompt");
    await provider.interpret("some prompt");

    expect(provider.usage).toMatchObject({ calls: 2, cacheHits: 1, inputTokens: 30, outputTokens: 12 });
    expect(provider.usage.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("records elapsed time for a real call in usage.totalDurationMs", async () => {
    const inner = {
      ...fakeProvider(),
      interpret: vi.fn(async (): Promise<ProviderResult> => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { text: "fresh", tokens: 1 };
      }),
    };
    const provider = new CachedProvider(inner, cache, "p1");

    await provider.interpret("some prompt");

    // Asserted as "nonzero", not against the 10ms sleep: `setTimeout` has no guaranteed lower
    // bound, so under parallel suite load the callback fires at ~9.5ms and the rounded duration
    // lands at 9. The claim under test is that a real call is timed at all.
    expect(provider.usage.totalDurationMs).toBeGreaterThanOrEqual(1);
  });

  describe("validate — never cache an unvalidated response", () => {
    const isJson = (text: string): boolean => {
      try {
        JSON.parse(text);
        return true;
      } catch {
        return false;
      }
    };

    it("does not store a response that fails validation, so a retry reaches the provider again", async () => {
      const inner = {
        ...fakeProvider(),
        interpret: vi.fn(async (): Promise<ProviderResult> => ({ text: "{not json", tokens: 1 })),
      };
      const provider = new CachedProvider(inner, cache, "p1");

      await provider.interpret("some prompt", { validate: isJson });
      await provider.interpret("some prompt", { validate: isJson });

      expect(inner.interpret).toHaveBeenCalledTimes(2);
    });

    it("still stores a response that passes validation", async () => {
      const inner = {
        ...fakeProvider(),
        interpret: vi.fn(async (): Promise<ProviderResult> => ({ text: '{"ok":true}', tokens: 1 })),
      };
      const provider = new CachedProvider(inner, cache, "p1");

      await provider.interpret("some prompt", { validate: isJson });
      await provider.interpret("some prompt", { validate: isJson });

      expect(inner.interpret).toHaveBeenCalledTimes(1);
    });

    // Test 13 — read side. A row poisoned by an earlier run must not be served forever.
    it("deletes a poisoned cached row, calls the provider, and logs the call as a miss", async () => {
      const inner = {
        ...fakeProvider(),
        interpret: vi.fn(async (): Promise<ProviderResult> => ({ text: '{"ok":true}', tokens: 1 })),
      };
      const provider = new CachedProvider(inner, cache, "p1");

      // Seed the exact row this prompt would look up, by writing once with validation off.
      await new CachedProvider(
        { ...fakeProvider(), interpret: vi.fn(async () => ({ text: "{not json", tokens: 1 })) },
        cache,
        "p1",
      ).interpret("some prompt");

      const result = await provider.interpret("some prompt", { validate: isJson, callMeta: { pass: "A" } });

      expect(result.text).toBe('{"ok":true}');
      expect(inner.interpret).toHaveBeenCalledTimes(1);
      expect(provider.usage.cacheHits).toBe(0);
      expect(cache.listCalls().at(-1)).toMatchObject({ cacheHit: false });
    });

    it("recovers a row that is valid JSON but fails the caller's schema check", async () => {
      const schemaOk = (text: string): boolean => {
        const parsed = JSON.parse(text) as { what?: unknown };
        return typeof parsed.what === "string";
      };
      const inner = {
        ...fakeProvider(),
        interpret: vi.fn(async (): Promise<ProviderResult> => ({ text: '{"what":"good"}', tokens: 1 })),
      };

      // Parseable JSON, so the one-shot sweep cannot detect it — only read-side validation can.
      await new CachedProvider(
        { ...fakeProvider(), interpret: vi.fn(async () => ({ text: '{"wrong":"shape"}', tokens: 1 })) },
        cache,
        "p1",
      ).interpret("some prompt");

      const provider = new CachedProvider(inner, cache, "p1");
      const result = await provider.interpret("some prompt", { validate: (t) => { try { return schemaOk(t); } catch { return false; } } });

      expect(result.text).toBe('{"what":"good"}');
      expect(inner.interpret).toHaveBeenCalledTimes(1);
    });

    it("leaves the hit path unchanged when no validate is supplied", async () => {
      const inner = fakeProvider();
      const provider = new CachedProvider(inner, cache, "p1");

      await provider.interpret("some prompt");
      await provider.interpret("some prompt");

      expect(inner.interpret).toHaveBeenCalledTimes(1);
    });

    it("never forwards validate to the underlying provider", async () => {
      const inner = fakeProvider();
      const provider = new CachedProvider(inner, cache, "p1");

      await provider.interpret("some prompt", { system: "sys", validate: isJson });

      const call = (inner.interpret as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toEqual({ system: "sys" });
    });
  });

  it("logs durationMs on the per-call row for both a real call and a cache hit", async () => {
    const inner = {
      ...fakeProvider(),
      interpret: vi.fn(async (): Promise<ProviderResult> => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { text: "fresh", tokens: 1 };
      }),
    };
    const provider = new CachedProvider(inner, cache, "p1");

    await provider.interpret("some prompt", { callMeta: { pass: "A" } });
    await provider.interpret("some prompt", { callMeta: { pass: "A" } });

    const calls = cache.listCalls();
    expect(calls[0]!.durationMs).toBeGreaterThanOrEqual(1);
    // A cache hit skips the provider entirely and logs a hardcoded 0, so this is an equality
    // check — `>= 0` would also pass for a real timed call and prove nothing.
    expect(calls[1]!.durationMs).toBe(0);
  });
});

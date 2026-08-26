import { createHash } from "node:crypto";
import type { ContentCache } from "./cache.js";
import type { Provider, ProviderContext, ProviderResult, ProviderUsage } from "./provider.js";

/**
 * Wraps a Provider with a ContentCache, keyed by a hash of the prompt (+ context) text plus
 * promptRev/provider/model. Makes the Interpreter idempotent for unchanged units across snapshots
 * — without this, LLM output non-determinism makes every unit look "changed" on every re-run,
 * even ones whose source text never moved. See analyze.md#2 "Cost control".
 */
export class CachedProvider implements Provider {
  private readonly usageState: ProviderUsage = { calls: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0, totalDurationMs: 0 };

  constructor(
    private readonly inner: Provider,
    private readonly cache: ContentCache,
    private readonly promptRev: string,
  ) {}

  get name(): string {
    return this.inner.name;
  }

  get model(): string {
    return this.inner.model;
  }

  get usage(): ProviderUsage {
    return { ...this.usageState };
  }

  async interpret(prompt: string, context?: ProviderContext): Promise<ProviderResult> {
    this.usageState.calls += 1;
    const inputHash = createHash("sha1")
      .update(prompt)
      .update(context?.system ?? "")
      .update(context?.cacheKeyExtra ?? "")
      .digest("hex");
    const key = { inputHash, promptRev: this.promptRev, provider: this.inner.name, model: this.inner.model };
    const callMeta = context?.callMeta;

    const validate = context?.validate;

    const cached = this.cache.get(key);
    if (cached) {
      // A row written before validation existed (or by a build without it) can be unusable. Evict
      // it rather than serving it, so the retry below can actually reach the provider.
      if (validate && !validate(cached.text)) {
        this.cache.delete(key);
      } else {
        this.usageState.cacheHits += 1;
        if (callMeta) this.cache.logCall({ ...callMeta, inTokens: 0, outTokens: 0, cacheHit: true, durationMs: 0 });
        return cached;
      }
    }

    const innerContext: ProviderContext | undefined = context?.system !== undefined ? { system: context.system } : undefined;
    const startedAt = performance.now();
    const result = await this.inner.interpret(prompt, innerContext);
    const durationMs = Math.round(performance.now() - startedAt);
    const inTokens = result.inputTokens ?? 0;
    const outTokens = result.outputTokens ?? result.tokens;
    this.usageState.inputTokens += inTokens;
    this.usageState.outputTokens += outTokens;
    this.usageState.totalDurationMs += durationMs;
    // Only cache what the caller can use. Caching first and validating later poisons the key: the
    // retry re-reads the same bad text and the unit can never succeed.
    if (!validate || validate(result.text)) this.cache.set(key, result);
    if (callMeta) this.cache.logCall({ ...callMeta, inTokens, outTokens, cacheHit: false, durationMs });
    return result;
  }
}

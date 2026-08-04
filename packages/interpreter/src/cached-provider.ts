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
  private readonly usageState: ProviderUsage = { calls: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0 };

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

    const cached = this.cache.get(key);
    if (cached) {
      this.usageState.cacheHits += 1;
      if (callMeta) this.cache.logCall({ ...callMeta, inTokens: 0, outTokens: 0, cacheHit: true });
      return cached;
    }

    const innerContext: ProviderContext | undefined = context?.system !== undefined ? { system: context.system } : undefined;
    const result = await this.inner.interpret(prompt, innerContext);
    const inTokens = result.inputTokens ?? 0;
    const outTokens = result.outputTokens ?? result.tokens;
    this.usageState.inputTokens += inTokens;
    this.usageState.outputTokens += outTokens;
    this.cache.set(key, result);
    if (callMeta) this.cache.logCall({ ...callMeta, inTokens, outTokens, cacheHit: false });
    return result;
  }
}

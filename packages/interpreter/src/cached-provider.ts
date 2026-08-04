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
    const inputHash = createHash("sha1").update(prompt).update(context?.system ?? "").digest("hex");
    const key = { inputHash, promptRev: this.promptRev, provider: this.inner.name, model: this.inner.model };

    const cached = this.cache.get(key);
    if (cached) {
      this.usageState.cacheHits += 1;
      return cached;
    }

    const result = await this.inner.interpret(prompt, context);
    this.usageState.inputTokens += result.inputTokens ?? 0;
    this.usageState.outputTokens += result.outputTokens ?? result.tokens;
    this.cache.set(key, result);
    return result;
  }
}

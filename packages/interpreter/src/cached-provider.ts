import { createHash } from "node:crypto";
import type { ContentCache } from "./cache.js";
import type { Provider, ProviderContext, ProviderResult } from "./provider.js";

/**
 * Wraps a Provider with a ContentCache, keyed by a hash of the prompt (+ context) text plus
 * promptRev/provider/model. Makes the Interpreter idempotent for unchanged units across snapshots
 * — without this, LLM output non-determinism makes every unit look "changed" on every re-run,
 * even ones whose source text never moved. See analyze.md#2 "Cost control".
 */
export class CachedProvider implements Provider {
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

  async interpret(prompt: string, context?: ProviderContext): Promise<ProviderResult> {
    const inputHash = createHash("sha1").update(prompt).update(context?.system ?? "").digest("hex");
    const key = { inputHash, promptRev: this.promptRev, provider: this.inner.name, model: this.inner.model };

    const cached = this.cache.get(key);
    if (cached) return cached;

    const result = await this.inner.interpret(prompt, context);
    this.cache.set(key, result);
    return result;
  }
}

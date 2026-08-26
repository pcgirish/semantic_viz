export interface ProviderContext {
  system?: string;
  /**
   * Extra text folded into CachedProvider's cache key but never sent to the model — e.g. a
   * digest of callee semantics a prompt references by qualname rather than embedding verbatim,
   * so a stale cache entry can't survive a dependency change the prompt text itself doesn't show.
   */
  cacheKeyExtra?: string;
  /**
   * Caller's usability check on the response text. CachedProvider refuses to cache a response
   * that fails it, and evicts a cached row that fails it, so a malformed reply cannot be frozen
   * in and served back to every later retry. Not sent to the model.
   */
  validate?: (text: string) => boolean;
  /** Call-site identity for per-call logging (docs/llm-call-observability.md). Not sent to the model. */
  callMeta?: {
    pass: "A" | "B" | "C" | "D" | "Docs";
    unitId?: string;
    qualname?: string;
    file?: string;
  };
}

export interface ProviderResult {
  text: string;
  /** Legacy provider token count, retained for compatibility with existing callers. */
  tokens: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ProviderUsage {
  calls: number;
  cacheHits: number;
  inputTokens: number;
  outputTokens: number;
  totalDurationMs: number;
}

export interface Provider {
  readonly name: string;
  readonly model: string;
  interpret(prompt: string, context?: ProviderContext): Promise<ProviderResult>;
}

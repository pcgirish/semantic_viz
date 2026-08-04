export interface ProviderContext {
  system?: string;
  /**
   * Extra text folded into CachedProvider's cache key but never sent to the model — e.g. a
   * digest of callee semantics a prompt references by qualname rather than embedding verbatim,
   * so a stale cache entry can't survive a dependency change the prompt text itself doesn't show.
   */
  cacheKeyExtra?: string;
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
}

export interface Provider {
  readonly name: string;
  readonly model: string;
  interpret(prompt: string, context?: ProviderContext): Promise<ProviderResult>;
}

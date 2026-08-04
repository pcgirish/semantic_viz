export interface ProviderContext {
  system?: string;
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

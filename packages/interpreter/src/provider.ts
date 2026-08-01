export interface ProviderContext {
  system?: string;
}

export interface ProviderResult {
  text: string;
  tokens: number;
}

export interface Provider {
  readonly name: string;
  readonly model: string;
  interpret(prompt: string, context?: ProviderContext): Promise<ProviderResult>;
}

import type { Provider, ProviderContext, ProviderResult } from "../provider.js";
import { logLlmCall, type LogLevel } from "../log.js";

export interface OllamaProviderOptions {
  model: string;
  host?: string;
  logLevel?: LogLevel;
}

const DEFAULT_HOST = "http://localhost:11434";

/** Talks to a local `ollama serve`. No batching, no prompt caching — see implement-analyze.md. */
export class OllamaProvider implements Provider {
  readonly name = "ollama";
  readonly model: string;
  private readonly host: string;
  private readonly logLevel?: LogLevel;

  constructor(options: OllamaProviderOptions) {
    this.model = options.model;
    this.host = options.host ?? DEFAULT_HOST;
    this.logLevel = options.logLevel;
  }

  async interpret(prompt: string, context?: ProviderContext): Promise<ProviderResult> {
    const res = await fetch(`${this.host}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt,
        system: context?.system,
        stream: false,
        think: false,
      }),
    });

    if (!res.ok) {
      throw new Error(`ollama request failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { response: string; prompt_eval_count?: number; eval_count?: number };
    const inputTokens = data.prompt_eval_count ?? 0;
    const outputTokens = data.eval_count ?? 0;
    // Keep Ollama's historical `tokens` value as the generated-token count; callers that
    // need both sides should use inputTokens/outputTokens.
    const tokens = outputTokens;
    logLlmCall(this.logLevel, { provider: this.name, model: this.model, prompt, response: data.response, tokens, inputTokens, outputTokens });
    return { text: data.response, tokens, inputTokens, outputTokens };
  }
}

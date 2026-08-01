import type { Provider, ProviderContext, ProviderResult } from "../provider.js";

export interface OllamaProviderOptions {
  model: string;
  host?: string;
}

const DEFAULT_HOST = "http://localhost:11434";

/** Talks to a local `ollama serve`. No batching, no prompt caching — see implement-analyze.md. */
export class OllamaProvider implements Provider {
  readonly name = "ollama";
  readonly model: string;
  private readonly host: string;

  constructor(options: OllamaProviderOptions) {
    this.model = options.model;
    this.host = options.host ?? DEFAULT_HOST;
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

    const data = (await res.json()) as { response: string; eval_count?: number };
    return { text: data.response, tokens: data.eval_count ?? 0 };
  }
}

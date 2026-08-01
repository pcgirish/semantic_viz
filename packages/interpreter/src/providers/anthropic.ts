import type { Provider, ProviderContext, ProviderResult } from "../provider.js";

export interface AnthropicProviderOptions {
  model: string;
  maxTokens?: number;
}

const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MAX_TOKENS = 1024;

/** Cloud provider via the Anthropic Messages API. Requires ANTHROPIC_API_KEY; metered, not free. */
export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly maxTokens: number;

  constructor(options: AnthropicProviderOptions) {
    this.model = options.model;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async interpret(prompt: string, context?: ProviderContext): Promise<ProviderResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        system: context?.system,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      throw new Error(`anthropic request failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as {
      content: { type: string; text: string }[];
      usage: { input_tokens: number; output_tokens: number };
    };
    const text = data.content.find((block) => block.type === "text")?.text ?? "";
    return { text, tokens: data.usage.input_tokens + data.usage.output_tokens };
  }
}

import { describe, expect, it, afterEach } from "vitest";
import { createProvider } from "../src/create-provider.js";
import { OllamaProvider } from "../src/providers/ollama.js";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { ClaudeCliProvider } from "../src/providers/claude-cli.js";

describe("createProvider", () => {
  const originalEnv = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalEnv;
  });

  it("builds an OllamaProvider for provider: ollama", () => {
    const provider = createProvider({ provider: "ollama", model: "qwen3.5:0.8b-mlx" });
    expect(provider).toBeInstanceOf(OllamaProvider);
    expect(provider.model).toBe("qwen3.5:0.8b-mlx");
  });

  it("builds an AnthropicProvider for provider: anthropic", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const provider = createProvider({ provider: "anthropic", model: "claude-sonnet-5" });
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it("builds a ClaudeCliProvider for provider: claude-cli", () => {
    const provider = createProvider({ provider: "claude-cli" });
    expect(provider).toBeInstanceOf(ClaudeCliProvider);
  });

  it("throws on an unknown provider name", () => {
    // @ts-expect-error - intentionally invalid
    expect(() => createProvider({ provider: "bogus" })).toThrow(/unknown provider/i);
  });
});

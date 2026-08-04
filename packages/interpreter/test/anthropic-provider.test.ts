import { describe, expect, it, vi, afterEach } from "vitest";
import { AnthropicProvider } from "../src/providers/anthropic.js";

describe("AnthropicProvider", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.ANTHROPIC_API_KEY = originalEnv;
  });

  it("posts to the messages API with the api key header and configured model", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "it increments a counter" }],
          usage: { input_tokens: 10, output_tokens: 8 },
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new AnthropicProvider({ model: "claude-sonnet-5" });
    const result = await provider.interpret("what does this do?");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.messages).toEqual([{ role: "user", content: "what does this do?" }]);

    expect(result.text).toBe("it increments a counter");
    expect(result.tokens).toBe(18);
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(8);
  });

  it("passes context.system as the top-level system field", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new AnthropicProvider({ model: "m" });
    await provider.interpret("prompt", { system: "you are terse" });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.system).toBe("you are terse");
  });

  it("throws if no API key is configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const provider = new AnthropicProvider({ model: "m" });
    await expect(provider.interpret("prompt")).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it("throws when the request fails", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new AnthropicProvider({ model: "m" });
    await expect(provider.interpret("prompt")).rejects.toThrow(/anthropic/i);
  });

  it("exposes provider name and model", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const provider = new AnthropicProvider({ model: "claude-sonnet-5" });
    expect(provider.name).toBe("anthropic");
    expect(provider.model).toBe("claude-sonnet-5");
  });
});

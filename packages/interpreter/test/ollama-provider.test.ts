import { describe, expect, it, vi, afterEach } from "vitest";
import { OllamaProvider } from "../src/providers/ollama.js";

describe("OllamaProvider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("posts to /api/generate with think disabled and the configured model", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ model: "qwen3.5:0.8b-mlx", response: "it increments a counter", prompt_eval_count: 34, eval_count: 12 }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OllamaProvider({ model: "qwen3.5:0.8b-mlx" });
    const result = await provider.interpret("what does this do?");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:11434/api/generate");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("qwen3.5:0.8b-mlx");
    expect(body.prompt).toBe("what does this do?");
    expect(body.stream).toBe(false);
    expect(body.think).toBe(false);

    expect(result.text).toBe("it increments a counter");
    expect(result.tokens).toBe(12);
    expect(result.inputTokens).toBe(34);
    expect(result.outputTokens).toBe(12);
  });

  it("passes context.system through as the system prompt", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ model: "m", response: "ok", eval_count: 1 }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OllamaProvider({ model: "m" });
    await provider.interpret("prompt", { system: "you are terse" });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.system).toBe("you are terse");
  });

  it("respects a custom host", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ model: "m", response: "ok", eval_count: 1 }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OllamaProvider({ model: "m", host: "http://example.internal:9999" });
    await provider.interpret("prompt");

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://example.internal:9999/api/generate");
  });

  it("throws when the request fails", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OllamaProvider({ model: "m" });
    await expect(provider.interpret("prompt")).rejects.toThrow(/ollama/i);
  });

  it("exposes provider name and model", () => {
    const provider = new OllamaProvider({ model: "qwen3.5:0.8b-mlx" });
    expect(provider.name).toBe("ollama");
    expect(provider.model).toBe("qwen3.5:0.8b-mlx");
  });

  it("logs the elapsed call duration in duration_ms", async () => {
    const fetchMock = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(JSON.stringify({ model: "m", response: "ok", eval_count: 1 }), { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const provider = new OllamaProvider({ model: "m", logLevel: "info" });
    await provider.interpret("prompt");

    const [line] = spy.mock.calls[0] as [string];
    const match = /duration_ms=(\d+)/.exec(line);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(10);
    spy.mockRestore();
  });
});

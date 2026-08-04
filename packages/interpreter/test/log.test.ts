import { describe, expect, it, vi, afterEach } from "vitest";
import { logLlmCall } from "../src/log.js";

describe("logLlmCall", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs provider, model, query, response, and tokens when level is info", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    logLlmCall("info", {
      provider: "ollama",
      model: "qwen3.6:0.8b-mlx",
      prompt: "summarize foo",
      response: "foo does bar",
      tokens: 42,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [line] = spy.mock.calls[0] as [string];
    expect(line).toContain("INFO");
    expect(line).toContain("ollama");
    expect(line).toContain("qwen3.6:0.8b-mlx");
    expect(line).toContain("summarize foo");
    expect(line).toContain("foo does bar");
    expect(line).toContain("42");
  });

  it("does not log when level is undefined", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    logLlmCall(undefined, {
      provider: "ollama",
      model: "m",
      prompt: "p",
      response: "r",
      tokens: 1,
    });

    expect(spy).not.toHaveBeenCalled();
  });
});

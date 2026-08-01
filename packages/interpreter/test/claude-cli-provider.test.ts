import { describe, expect, it, vi, beforeEach } from "vitest";

const execFileMock = vi.fn();
const stdinEndMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => {
    execFileMock(...args);
    return { stdin: { end: stdinEndMock } };
  },
}));

const { ClaudeCliProvider } = await import("../src/providers/claude-cli.js");

function mockResult(stdout: object) {
  execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
    cb(null, JSON.stringify(stdout), "");
  });
}

describe("ClaudeCliProvider", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    stdinEndMock.mockReset();
  });

  it("shells out to `claude -p` with --output-format json, defaulting to sonnet at low effort", async () => {
    mockResult({ result: "it increments a counter", usage: { input_tokens: 5, output_tokens: 7 } });

    const provider = new ClaudeCliProvider();
    const result = await provider.interpret("what does this do?");

    expect(execFileMock).toHaveBeenCalledOnce();
    const [cmd, args] = execFileMock.mock.calls[0]!;
    expect(cmd).toBe("claude");
    expect(args).toContain("-p");
    expect(args).toContain("what does this do?");
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
    expect(args).toContain("--model");
    expect(args).toContain("sonnet");
    expect(args).toContain("--effort");
    expect(args).toContain("low");

    expect(result.text).toBe("it increments a counter");
    expect(result.tokens).toBe(12);
  });

  it("accepts a custom model and effort", async () => {
    mockResult({ result: "ok", usage: { input_tokens: 1, output_tokens: 1 } });

    const provider = new ClaudeCliProvider({ model: "opus", effort: "high" });
    await provider.interpret("prompt");

    const [, args] = execFileMock.mock.calls[0]!;
    expect(args).toContain("--model");
    expect(args).toContain("opus");
    expect(args).toContain("--effort");
    expect(args).toContain("high");
  });

  it("passes context.system via --append-system-prompt", async () => {
    mockResult({ result: "ok", usage: { input_tokens: 1, output_tokens: 1 } });

    const provider = new ClaudeCliProvider();
    await provider.interpret("prompt", { system: "you are terse" });

    const [, args] = execFileMock.mock.calls[0]!;
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("you are terse");
  });

  it("rejects when the subprocess errors", async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(new Error("command not found"), "", "");
    });

    const provider = new ClaudeCliProvider();
    await expect(provider.interpret("prompt")).rejects.toThrow(/command not found/);
  });

  it("closes stdin so the subprocess never blocks waiting for input", async () => {
    mockResult({ result: "ok", usage: { input_tokens: 1, output_tokens: 1 } });

    const provider = new ClaudeCliProvider();
    await provider.interpret("prompt");

    expect(stdinEndMock).toHaveBeenCalledOnce();
  });

  it("exposes provider name and model, defaulting to sonnet", () => {
    const provider = new ClaudeCliProvider();
    expect(provider.name).toBe("claude-cli");
    expect(provider.model).toBe("sonnet");
  });
});

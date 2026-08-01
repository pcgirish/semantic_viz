import { describe, expect, it, vi, beforeEach } from "vitest";

const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
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
  });

  it("shells out to `claude -p` with --output-format json", async () => {
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

    expect(result.text).toBe("it increments a counter");
    expect(result.tokens).toBe(12);
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

  it("exposes provider name; model reflects whatever the CLI resolves, unpinned", () => {
    const provider = new ClaudeCliProvider();
    expect(provider.name).toBe("claude-cli");
    expect(provider.model).toBe("unpinned");
  });
});

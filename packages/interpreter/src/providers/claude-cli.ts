import { execFile } from "node:child_process";
import type { Provider, ProviderContext, ProviderResult } from "../provider.js";
import { logLlmCall, type LogLevel } from "../log.js";

interface ClaudeCliJsonOutput {
  result: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface ClaudeCliProviderOptions {
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  logLevel?: LogLevel;
}

const DEFAULT_MODEL = "sonnet";
const DEFAULT_EFFORT = "low";

/**
 * Shells out to the `claude` CLI, authenticated via Pro/Max OAuth rather than
 * ANTHROPIC_API_KEY — usage draws down plan quota, not metered billing.
 * Dev/eval only; see implement-analyze.md.
 */
export class ClaudeCliProvider implements Provider {
  readonly name = "claude-cli";
  readonly model: string;
  readonly effortLevel: string;
  private readonly logLevel?: LogLevel;

  constructor(options: ClaudeCliProviderOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.effortLevel = options.effort ?? DEFAULT_EFFORT;
    this.logLevel = options.logLevel;
  }

  async interpret(prompt: string, context?: ProviderContext): Promise<ProviderResult> {
    const args = [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--model",
      this.model,
      "--effort",
      this.effortLevel,
    ];
    if (context?.system) {
      args.push("--append-system-prompt", context.system);
    }

    const startedAt = performance.now();
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = execFile("claude", args, { maxBuffer: 10 * 1024 * 1024 }, (error, out) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(out);
      });
      // Without this, the CLI can hang waiting for stdin input we never send.
      child.stdin?.end();
    });

    const durationMs = Math.round(performance.now() - startedAt);
    const data = JSON.parse(stdout) as ClaudeCliJsonOutput;
    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;
    const tokens = inputTokens + outputTokens;
    logLlmCall(this.logLevel, { provider: this.name, model: this.model, prompt, response: data.result, tokens, inputTokens, outputTokens, durationMs });
    return { text: data.result, tokens, inputTokens, outputTokens };
  }
}

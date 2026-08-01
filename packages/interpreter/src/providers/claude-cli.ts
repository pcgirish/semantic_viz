import { execFile } from "node:child_process";
import type { Provider, ProviderContext, ProviderResult } from "../provider.js";

interface ClaudeCliJsonOutput {
  result: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Shells out to the `claude` CLI, authenticated via Pro/Max OAuth rather than
 * ANTHROPIC_API_KEY — usage draws down plan quota, not metered billing.
 * Dev/eval only; see implement-analyze.md.
 */
export class ClaudeCliProvider implements Provider {
  readonly name = "claude-cli";
  readonly model = "unpinned";

  async interpret(prompt: string, context?: ProviderContext): Promise<ProviderResult> {
    const args = ["-p", prompt, "--output-format", "json"];
    if (context?.system) {
      args.push("--append-system-prompt", context.system);
    }

    const stdout = await new Promise<string>((resolve, reject) => {
      execFile("claude", args, { maxBuffer: 10 * 1024 * 1024 }, (error, out) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(out);
      });
    });

    const data = JSON.parse(stdout) as ClaudeCliJsonOutput;
    const tokens = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);
    return { text: data.result, tokens };
  }
}

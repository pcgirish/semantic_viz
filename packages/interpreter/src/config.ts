import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";

/**
 * The shape `config.yaml` is allowed to have. Hand-edited by users, so an unknown provider or a
 * misspelled effort should surface here naming the field, not several layers later as a
 * "no such provider" from `createProvider` or a silently ignored option.
 */
export const InterpreterConfigSchema = z.object({
  provider: z.enum(["ollama", "anthropic", "claude-cli"]),
  model: z.string().optional(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  logLevel: z.literal("info").optional(),
});

export type InterpreterConfig = z.infer<typeof InterpreterConfigSchema>;

const DEFAULT_CONFIG: InterpreterConfig = { provider: "ollama" };

/** Reads `interpreter.provider`/`.model`/`.effort` from `<scvDir>/config.yaml`; falls back to the ollama default when absent. */
export function loadInterpreterConfig(scvDir: string): InterpreterConfig {
  const configPath = path.join(scvDir, "config.yaml");
  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  const raw = parse(readFileSync(configPath, "utf-8")) as { interpreter?: unknown } | null;
  const merged = { ...DEFAULT_CONFIG, ...(raw?.interpreter as object | undefined) };
  const parsed = InterpreterConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    const at = issue && issue.path.length > 0 ? ` at interpreter.${issue.path.join(".")}` : "";
    throw new Error(`${configPath}: invalid config${at}${issue ? `: ${issue.message}` : ""}`);
  }
  return parsed.data;
}

/** Writes `config` under an `interpreter:` key to `<scvDir>/config.yaml`, creating `scvDir` if needed. Overwrites any existing file. */
export function writeInterpreterConfig(scvDir: string, config: InterpreterConfig): void {
  mkdirSync(scvDir, { recursive: true });
  writeFileSync(path.join(scvDir, "config.yaml"), stringify({ interpreter: config }));
}

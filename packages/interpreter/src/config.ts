import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";

export interface InterpreterConfig {
  provider: "ollama" | "anthropic" | "claude-cli";
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

const DEFAULT_CONFIG: InterpreterConfig = { provider: "ollama" };

/** Reads `interpreter.provider`/`.model`/`.effort` from `<scvDir>/config.yaml`; falls back to the ollama default when absent. */
export function loadInterpreterConfig(scvDir: string): InterpreterConfig {
  const configPath = path.join(scvDir, "config.yaml");
  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  const raw = parse(readFileSync(configPath, "utf-8")) as { interpreter?: InterpreterConfig };
  return { ...DEFAULT_CONFIG, ...raw.interpreter };
}

/** Writes `config` under an `interpreter:` key to `<scvDir>/config.yaml`, creating `scvDir` if needed. Overwrites any existing file. */
export function writeInterpreterConfig(scvDir: string, config: InterpreterConfig): void {
  mkdirSync(scvDir, { recursive: true });
  writeFileSync(path.join(scvDir, "config.yaml"), stringify({ interpreter: config }));
}

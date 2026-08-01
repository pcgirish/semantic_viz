import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

export interface InterpreterConfig {
  provider: "ollama" | "anthropic" | "claude-cli";
  model?: string;
}

const DEFAULT_CONFIG: InterpreterConfig = { provider: "ollama" };

/** Reads `interpreter.provider`/`.model` from `<scvDir>/config.yaml`; falls back to the ollama default when absent. */
export function loadInterpreterConfig(scvDir: string): InterpreterConfig {
  const configPath = path.join(scvDir, "config.yaml");
  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  const raw = parse(readFileSync(configPath, "utf-8")) as { interpreter?: InterpreterConfig };
  return { ...DEFAULT_CONFIG, ...raw.interpreter };
}

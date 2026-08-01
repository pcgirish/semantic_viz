import type { InterpreterConfig } from "./config.js";
import type { Provider } from "./provider.js";
import { OllamaProvider } from "./providers/ollama.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { ClaudeCliProvider } from "./providers/claude-cli.js";

const DEFAULT_OLLAMA_MODEL = "qwen3.5:0.8b-mlx";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

export function createProvider(config: InterpreterConfig): Provider {
  switch (config.provider) {
    case "ollama":
      return new OllamaProvider({ model: config.model ?? DEFAULT_OLLAMA_MODEL });
    case "anthropic":
      return new AnthropicProvider({ model: config.model ?? DEFAULT_ANTHROPIC_MODEL });
    case "claude-cli":
      return new ClaudeCliProvider({ model: config.model });
    default:
      throw new Error(`unknown provider: ${config.provider as string}`);
  }
}

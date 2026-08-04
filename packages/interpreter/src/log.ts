export type LogLevel = "info";

export interface LlmCallLog {
  provider: string;
  model: string;
  prompt: string;
  response: string;
  tokens: number;
}

/** Logs one LLM call to stderr when level is "info"; no-op otherwise. */
export function logLlmCall(level: LogLevel | undefined, call: LlmCallLog): void {
  if (level !== "info") {
    return;
  }

  console.error(
    `[INFO] llm-call provider=${call.provider} model=${call.model} tokens=${call.tokens} query=${JSON.stringify(call.prompt)} response=${JSON.stringify(call.response)}`,
  );
}

import type { z } from "zod";
import type { Provider, ProviderContext } from "./provider.js";
import { parseJsonResponse } from "./json-response.js";

export interface InterpretJsonWithRetryOptions<T extends z.ZodTypeAny> {
  provider: Provider;
  prompt: string;
  label: string;
  schema: T;
  context?: ProviderContext;
  maxAttempts?: number;
}

const DEFAULT_MAX_ATTEMPTS = 2;

/**
 * Calls the provider and parses+validates its response against `schema`, retrying the whole
 * round-trip (not just the parse) on failure. LLM output errors like a stray comma in place of a
 * colon, or a field with the wrong type, are stochastic per-call — a fresh call is far more
 * likely to succeed than any further parsing cleverness applied to the same bad response.
 */
export async function interpretJsonWithRetry<T extends z.ZodTypeAny>(
  options: InterpretJsonWithRetryOptions<T>,
): Promise<z.infer<T>> {
  const { provider, prompt, label, schema, context, maxAttempts = DEFAULT_MAX_ATTEMPTS } = options;

  // "Usable" here means exactly what the loop below demands: parses as JSON *and* satisfies the
  // schema. Handing this to the provider keeps an unusable response out of the cache, so the next
  // attempt is a fresh call rather than a replay of the same failure.
  const validate = (text: string): boolean => {
    try {
      schema.parse(parseJsonResponse(text, label));
      return true;
    } catch {
      return false;
    }
  };
  const callContext: ProviderContext = { ...context, validate };

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { text } = await provider.interpret(prompt, callContext);
    try {
      const parsed = parseJsonResponse(text, label);
      return schema.parse(parsed);
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(`${label}: failed after ${maxAttempts} attempt(s): ${String(lastError)}`);
}

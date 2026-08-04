import { z } from "zod";
import type { Provider } from "./provider.js";
import { passDPrompt } from "./prompts/pass-d.js";
import type { PassDContext } from "./prompts/pass-d.js";
import { interpretJsonWithRetry } from "./retry.js";

const RiskAxesResponseSchema = z.object({
  functionality: z.number().min(0).max(1),
  availability: z.number().min(0).max(1),
  scalability: z.number().min(0).max(1),
  performance: z.number().min(0).max(1),
  security: z.number().min(0).max(1),
});

const PassDResponseSchema = z.object({
  axes: RiskAxesResponseSchema,
  why: z.string(),
  confidence: z.number().min(0).max(1),
});

export interface PassDResult {
  score: number;
  axes: z.infer<typeof RiskAxesResponseSchema>;
  why: string;
  confidence: number;
  source: "llm";
}

export interface RunPassDOptions {
  context: PassDContext;
  provider: Provider;
  promptRev: string;
}

/** Pass D — risk narration for one unit whose semantic_hash changed. `score` is the max of the five independent axes. See analyze.md#4. */
export async function runPassD(options: RunPassDOptions): Promise<PassDResult> {
  const { context, provider } = options;
  const prompt = passDPrompt(context);
  const response = await interpretJsonWithRetry({
    provider,
    prompt,
    label: `pass D: ${context.qualname}`,
    schema: PassDResponseSchema,
    context: { callMeta: { pass: "D", qualname: context.qualname } },
  });

  return {
    score: Math.max(...Object.values(response.axes)),
    axes: response.axes,
    why: response.why,
    confidence: response.confidence,
    source: "llm",
  };
}

import { z } from "zod";
import type { Provider } from "./provider.js";
import { passCPrompt } from "./prompts/pass-c.js";
import type { ClusterProposal } from "./checker.js";
import { parseJsonResponse } from "./json-response.js";

const PassCResponseSchema = z.object({
  why: z.string(),
  confidence: z.number().min(0).max(1),
});

export interface Layer {
  name: string;
  files: string[];
  why: string;
  confidence: number;
  source: "llm";
}

export interface PassCResult {
  layers: Layer[];
}

export interface RunPassCOptions {
  clusters: ClusterProposal;
  oneLiners: Record<string, string>;
  provider: Provider;
  promptRev: string;
}

/** Pass C — architecture narration. One LLM call per Pass B cluster, producing a layer's `why`. See analyze.md#2. */
export async function runPassC(options: RunPassCOptions): Promise<PassCResult> {
  const { clusters, oneLiners, provider } = options;
  const layers: Layer[] = [];

  for (const [name, files] of Object.entries(clusters)) {
    const prompt = passCPrompt(name, files, oneLiners);
    const { text } = await provider.interpret(prompt);

    const parsed = parseJsonResponse(text, `pass C: cluster "${name}"`);
    const response = PassCResponseSchema.parse(parsed);
    layers.push({ name, files, why: response.why, confidence: response.confidence, source: "llm" });
  }

  return { layers };
}

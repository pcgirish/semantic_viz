import { z } from "zod";
import type { Provider } from "./provider.js";
import { passCPrompt } from "./prompts/pass-c.js";
import type { ClusterProposal } from "./checker.js";
import { interpretJsonWithRetry } from "./retry.js";

const PassCResponseSchema = z.object({
  what: z.string(),
  how: z.string(),
  when: z.string(),
  where: z.string(),
  why: z.string(),
  confidence: z.number().min(0).max(1),
});

export interface Layer {
  name: string;
  files: string[];
  what: string;
  how: string;
  when: string;
  where: string;
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
    const response = await interpretJsonWithRetry({
      provider,
      prompt,
      label: `pass C: cluster "${name}"`,
      schema: PassCResponseSchema,
    });
    layers.push({
      name,
      files,
      what: response.what,
      how: response.how,
      when: response.when,
      where: response.where,
      why: response.why,
      confidence: response.confidence,
      source: "llm",
    });
  }

  return { layers };
}

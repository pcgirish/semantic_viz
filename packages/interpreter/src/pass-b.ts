import { z } from "zod";
import type { Provider } from "./provider.js";
import { passBPrompt } from "./prompts/pass-b.js";
import { checkAndRepairClusters, directoryClusters, modularity } from "./checker.js";
import type { ClusterProposal, ImportEdge } from "./checker.js";
import { parseJsonResponse } from "./json-response.js";

const PassBResponseSchema = z.object({
  clusters: z.record(z.string(), z.array(z.string())),
});

export interface PassBResult {
  clusters: ClusterProposal;
  repaired: boolean;
  modularity: number;
  directoryModularity: number;
}

export interface RunPassBOptions {
  files: string[];
  oneLiners: Record<string, string>;
  edges: ImportEdge[];
  provider: Provider;
  promptRev: string;
}

/** Pass B — clustering. The LLM proposes, the deterministic checker validates and repairs. See analyze.md#2. */
export async function runPassB(options: RunPassBOptions): Promise<PassBResult> {
  const { files, oneLiners, edges, provider } = options;
  const prompt = passBPrompt(files, oneLiners, edges);
  const { text } = await provider.interpret(prompt);

  const parsed = parseJsonResponse(text, "pass B");
  const response = PassBResponseSchema.parse(parsed);
  const { clusters, repaired } = checkAndRepairClusters(response.clusters, files);

  return {
    clusters,
    repaired,
    modularity: modularity(clusters, edges),
    directoryModularity: modularity(directoryClusters(files), edges),
  };
}

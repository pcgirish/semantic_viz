import { z } from "zod";
import type { Provider } from "./provider.js";
import { passBPrompt } from "./prompts/pass-b.js";
import { checkAndRepairClusters, directoryClusters, modularity } from "./checker.js";
import type { ClusterProposal, ImportEdge } from "./checker.js";
import { interpretJsonWithRetry } from "./retry.js";

const ClusterMapSchema = z.record(z.string(), z.array(z.string()));

function isWrapped(value: Record<string, string[]> | { clusters: Record<string, string[]> }): value is {
  clusters: Record<string, string[]>;
} {
  return "clusters" in value && !Array.isArray(value.clusters) && typeof value.clusters === "object";
}

// Some local models drop the "clusters" wrapper the prompt asks for and return the
// cluster map directly at the root — accept both shapes rather than failing the pass.
const PassBResponseSchema = z
  .union([z.object({ clusters: ClusterMapSchema }), ClusterMapSchema])
  .transform((value) => (isWrapped(value) ? value : { clusters: value }));

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
  repoContext?: string;
}

/** Pass B — clustering. The LLM proposes, the deterministic checker validates and repairs. See analyze.md#2. */
export async function runPassB(options: RunPassBOptions): Promise<PassBResult> {
  const { files, oneLiners, edges, provider, repoContext } = options;
  const prompt = passBPrompt(files, oneLiners, edges, repoContext);
  const response = await interpretJsonWithRetry({
    provider,
    prompt,
    label: "pass B",
    schema: PassBResponseSchema,
    context: { callMeta: { pass: "B" } },
  });
  const { clusters, repaired } = checkAndRepairClusters(response.clusters, files);

  return {
    clusters,
    repaired,
    modularity: modularity(clusters, edges),
    directoryModularity: modularity(directoryClusters(files), edges),
  };
}

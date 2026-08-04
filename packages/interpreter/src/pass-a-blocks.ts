import { z } from "zod";
import type { SymbolBlock } from "@scv/extractor";
import type { Provider } from "./provider.js";
import { passABlocksPrompt } from "./prompts/pass-a-blocks.js";
import { interpretJsonWithRetry } from "./retry.js";

const PassABlocksResponseSchema = z.object({
  labels: z.array(z.object({ blockId: z.string(), label: z.string() })),
});

export interface RunPassABlocksOptions {
  blocks: SymbolBlock[];
  source: string;
  functionQualname: string;
  provider: Provider;
  promptRev: string;
}

/** Pass A-blocks — one batched LLM call per function labeling all of its control-flow
 *  blocks for the flowchart view (docs/plans/flowchart-block-labels-readability.md). Returns
 *  blockId -> label; blocks the model omits from its response are simply absent from the
 *  map, letting the caller fall back to the block's structural type/condition. */
export async function runPassABlocks(options: RunPassABlocksOptions): Promise<Map<string, string>> {
  const { blocks, source, functionQualname, provider } = options;
  if (blocks.length === 0) return new Map();

  const prompt = passABlocksPrompt(blocks, source, functionQualname);
  const response = await interpretJsonWithRetry({
    provider,
    prompt,
    label: `pass A blocks: ${functionQualname}`,
    schema: PassABlocksResponseSchema,
    context: {
      callMeta: { pass: "A", qualname: functionQualname },
    },
  });

  const result = new Map<string, string>();
  for (const { blockId, label } of response.labels) {
    result.set(blockId, label);
  }
  return result;
}

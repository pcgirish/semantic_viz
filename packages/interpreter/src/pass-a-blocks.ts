import { z } from "zod";
import type { SymbolBlock, SymbolControlFlowEdge } from "@semviz/extractor";
import type { Provider } from "./provider.js";
import { passABlocksPrompt } from "./prompts/pass-a-blocks.js";
import { interpretJsonWithRetry } from "./retry.js";

const PassABlocksResponseSchema = z.object({
  labels: z.array(
    z.object({
      blockId: z.string(),
      label: z.string(),
      trueLabel: z.string().optional(),
      falseLabel: z.string().optional(),
      outcome: z.enum(["success", "error"]).optional(),
    }),
  ),
});

export interface RunPassABlocksOptions {
  blocks: SymbolBlock[];
  /** Control-flow edges for this function's block graph — used to cross-check the model's
   *  reported exit-block "outcome" against the deterministic `raises` signal. Optional and
   *  defaults to none, in which case the outcome consistency check is simply skipped. */
  edges?: SymbolControlFlowEdge[];
  source: string;
  functionQualname: string;
  provider: Provider;
  promptRev: string;
}

export interface BlockLabel {
  label: string;
  /** decision/loop blocks only — what the "true" and "false" control_flow edges out of
   *  this block actually mean (e.g. "invalid"/"valid"), since the raw true/false truth
   *  value only reads as "yes"/"no" when it happens to match the label's own polarity. */
  trueLabel?: string;
  falseLabel?: string;
}

function applyLabels(
  response: z.infer<typeof PassABlocksResponseSchema>,
  branchingBlockIds: Set<string>,
  result: Map<string, BlockLabel>,
  outcomeByBlockId: Map<string, "success" | "error">,
): void {
  for (const { blockId, label, trueLabel, falseLabel, outcome } of response.labels) {
    // The model sometimes attaches trueLabel/falseLabel to the wrong block (e.g. the exit
    // block a decision raises into) instead of the decision/loop block itself — drop them
    // there so a stray label can never surface as an edgeLabel on the wrong edge.
    if (branchingBlockIds.has(blockId)) {
      result.set(blockId, { label, trueLabel, falseLabel });
    } else {
      result.set(blockId, { label });
    }
    if (outcome) outcomeByBlockId.set(blockId, outcome);
  }
}

/** Exit blocks reached by an edge with raises:true structurally represent an error/failure
 *  outcome — a deterministic ground truth independent of the model's own labeling. Used to
 *  catch cases like an LLM swapping the labels of a function's success vs. error exit blocks. */
function expectedOutcome(blockId: string, edges: SymbolControlFlowEdge[]): "success" | "error" {
  return edges.some((e) => e.to === blockId && e.raises) ? "error" : "success";
}

/** Pass A-blocks — one batched LLM call per function labeling all of its control-flow
 *  blocks for the flowchart view (docs/plans/flowchart-block-labels-readability.md). Returns
 *  blockId -> label; blocks the model omits from its response are simply absent from the
 *  map, letting the caller fall back to the block's structural type/condition. */
export async function runPassABlocks(options: RunPassABlocksOptions): Promise<Map<string, BlockLabel>> {
  const { blocks, edges = [], source, functionQualname, provider } = options;
  if (blocks.length === 0) return new Map();

  const branchingBlockIds = new Set(blocks.filter((b) => b.blockType === "decision" || b.blockType === "loop").map((b) => b.id));
  const exitBlockIds = new Set(blocks.filter((b) => b.blockType === "exit").map((b) => b.id));

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

  const result = new Map<string, BlockLabel>();
  const outcomeByBlockId = new Map<string, "success" | "error">();
  applyLabels(response, branchingBlockIds, result, outcomeByBlockId);

  // The schema allows trueLabel/falseLabel to be omitted, so a schema-valid response can
  // still leave a decision/loop block without them — the model just didn't follow the
  // instruction for that block. Re-ask, scoped to only the incomplete blocks, once.
  const incompleteBlockIds = new Set(
    [...branchingBlockIds].filter((id) => {
      const entry = result.get(id);
      return !entry || entry.trueLabel === undefined || entry.falseLabel === undefined;
    }),
  );

  // The model can also mislabel an exit block's actual outcome (e.g. swap a function's
  // success and error exits) even though the block graph already knows, deterministically,
  // which exits are reached via a raise. Re-ask, scoped to only the disagreeing blocks, once.
  const inconsistentOutcomeIds = new Set(
    [...exitBlockIds].filter((id) => {
      const reported = outcomeByBlockId.get(id);
      return reported !== undefined && reported !== expectedOutcome(id, edges);
    }),
  );

  const retryBlockIds = new Set([...incompleteBlockIds, ...inconsistentOutcomeIds]);
  if (retryBlockIds.size > 0) {
    const retryBlocks = blocks.filter((b) => retryBlockIds.has(b.id));
    const retryPrompt = passABlocksPrompt(retryBlocks, source, functionQualname);
    const retryResponse = await interpretJsonWithRetry({
      provider,
      prompt: retryPrompt,
      label: `pass A blocks (retry incomplete): ${functionQualname}`,
      schema: PassABlocksResponseSchema,
      context: {
        callMeta: { pass: "A", qualname: functionQualname },
      },
    });
    applyLabels(retryResponse, branchingBlockIds, result, outcomeByBlockId);
  }

  return result;
}

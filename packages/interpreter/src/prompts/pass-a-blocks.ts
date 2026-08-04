import type { SymbolBlock } from "@scv/extractor";

/** Renders one block's own source span, sliced from the full function source by line
 *  number (both 1-indexed, matching SymbolBlock.startLine/endLine). */
function blockSourceText(block: SymbolBlock, functionSource: string, functionStartLine: number): string {
  const lines = functionSource.split("\n");
  const startIdx = Math.max(0, block.startLine - functionStartLine);
  const endIdx = Math.min(lines.length, block.endLine - functionStartLine + 1);
  return lines.slice(startIdx, endIdx).join("\n").trim();
}

/** Pass A-blocks prompt: one short semantic label per control-flow block in a function,
 *  batched into a single call so labeling a function's flowchart costs one round-trip, not
 *  one per block. See docs/plans/flowchart-block-labels-readability.md. */
export function passABlocksPrompt(blocks: SymbolBlock[], functionSource: string, functionQualname: string): string {
  const functionStartLine = Math.min(...blocks.map((b) => b.startLine));

  const blockList = blocks
    .map((b) => {
      const span = blockSourceText(b, functionSource, functionStartLine);
      const conditionLine = b.condition ? `Condition: ${b.condition}\n` : "";
      return `- id: ${b.id}\n  type: ${b.blockType}\n  ${conditionLine}  Code:\n  \`\`\`\n  ${span.split("\n").join("\n  ")}\n  \`\`\``;
    })
    .join("\n");

  return `You are labeling the control-flow blocks of a single function for a flowchart diagram.

Function: ${functionQualname}

Full source:
\`\`\`
${functionSource}
\`\`\`

Blocks:
${blockList}

For each block, produce a short label (2-5 words) for a flowchart node:
- "entry"/"exit" blocks: a short label naming the step (e.g. "return 400", "emit confirmation") — for exit/raise blocks, name the concrete result if inferable from the code (status code, error), not just "return".
- "decision"/"loop" blocks: rephrase the condition as a short yes/no question (e.g. "valid?", "items left?"), not the raw source expression.
- "sequential" blocks: name the action the code span performs (e.g. "validate payload", "persist order (db)"), not a restatement of the type.
- "try"/"catch"/"merge" blocks: a short label for what the block represents (e.g. "charge payment", "rollback").

Respond with JSON only, matching exactly this shape:
{
  "labels": [{ "blockId": "...", "label": "..." }]
}

One entry per block listed above, same blockId values. No prose outside the JSON object.`;
}

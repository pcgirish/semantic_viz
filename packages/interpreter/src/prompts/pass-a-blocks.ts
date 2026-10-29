import type { SymbolBlock } from "@semviz/extractor";

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
- "entry"/"exit" blocks: a short label naming the step (e.g. "return 400", "emit confirmation") — for exit/raise blocks, name the concrete result if inferable from the code (status code, error), not just "return". For "exit" blocks, also give "outcome": "success" if this exit represents the function completing normally, or "error" if it represents a raise/throw/error return — base this strictly on the block's own code span, not on the label text.
- "decision"/"loop" blocks: a short label naming what's being checked (e.g. "validity check", "items left"), not the raw source expression. Do not invert or negate the raw condition's sense in this label (e.g. for "order is None", label it "order missing?" or "order found?" consistently with the condition — not "order exists?", which flips true/false and will make trueLabel/falseLabel read backwards). Also give "trueLabel" and "falseLabel": a single word each (rarely two, never more) naming what each branch means when the *raw source condition* evaluates true/false (e.g. for "not payload.ok", trueLabel: "invalid", falseLabel: "valid"; for "order is None", trueLabel: "missing", falseLabel: "found"). These become the flowchart's branch edge labels — as terse as "yes"/"no" would be, but semantically correct for the block's own condition, so get the polarity right rather than defaulting to generic "yes"/"no".
- "sequential" blocks: name the action the code span performs (e.g. "validate payload", "persist order (db)"), not a restatement of the type.
- "try"/"catch"/"merge" blocks: a short label for what the block represents (e.g. "charge payment", "rollback").

Respond with JSON only, matching exactly this shape:
{
  "labels": [{ "blockId": "...", "label": "...", "trueLabel": "...", "falseLabel": "...", "outcome": "success" }]
}

Omit "trueLabel"/"falseLabel" for non-"decision"/"loop" blocks. Omit "outcome" for non-"exit" blocks. One entry per block listed above, same blockId values. No prose outside the JSON object.`;
}

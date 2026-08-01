import { z } from "zod";
import type { Provider } from "./provider.js";
import { rankPrompt } from "./prompts/rank.js";
import type { RankCandidate } from "./prompts/rank.js";
import { parseJsonResponse } from "./json-response.js";

const RankResponseSchema = z.object({ ranked: z.array(z.number()) });

export interface RankedEntry extends RankCandidate {
  rank: number;
}

export interface RankInspectQueueOptions {
  candidates: RankCandidate[];
  provider: Provider;
  promptRev: string;
}

/**
 * Orders changed units by what a human should look at first — the Interpreter's judgment, not a
 * sort by risk.score. See analyze.md#rank-is-not-score.
 *
 * The LLM ranks by 1-indexed candidate NUMBER rather than retyping unit ids: ids like
 * `u:layer:232dc3263ff5` are easy for a model to mistype or truncate when copying them into a
 * JSON array, and a single dropped character used to fail the whole rank with no recovery.
 * Numbers eliminate that failure mode entirely.
 */
export async function rankInspectQueue(options: RankInspectQueueOptions): Promise<RankedEntry[]> {
  const { candidates, provider } = options;
  if (candidates.length === 0) return [];

  const prompt = rankPrompt(candidates);
  const { text } = await provider.interpret(prompt);

  const parsed = parseJsonResponse(text, "rank inspect queue");
  const response = RankResponseSchema.parse(parsed);

  const expected = new Set(candidates.map((_, i) => i + 1));
  const got = new Set(response.ranked);
  if (got.size !== expected.size || [...expected].some((n) => !got.has(n))) {
    throw new Error(
      `rank inspect queue: provider's ranked list does not match candidate numbers 1-${candidates.length} exactly (got ${response.ranked.join(", ")})`,
    );
  }

  return response.ranked.map((position, i) => ({ ...candidates[position - 1]!, rank: i + 1 }));
}

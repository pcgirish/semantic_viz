import { z } from "zod";
import type { Provider } from "./provider.js";
import { rankPrompt } from "./prompts/rank.js";
import type { RankCandidate } from "./prompts/rank.js";
import { interpretJsonWithRetry } from "./retry.js";

export interface RankedEntry extends RankCandidate {
  rank: number;
}

function rankResponseSchema(candidateCount: number) {
  return z.object({ ranked: z.array(z.number()) }).refine(
    ({ ranked }) => {
      const expected = new Set(Array.from({ length: candidateCount }, (_, i) => i + 1));
      const got = new Set(ranked);
      return got.size === expected.size && [...expected].every((n) => got.has(n));
    },
    { message: `ranked list must be an exact permutation of 1-${candidateCount}` },
  );
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
  const response = await interpretJsonWithRetry({
    provider,
    prompt,
    label: "rank inspect queue",
    schema: rankResponseSchema(candidates.length),
  });

  return response.ranked.map((position, i) => ({ ...candidates[position - 1]!, rank: i + 1 }));
}

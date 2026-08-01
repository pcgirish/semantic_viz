import { z } from "zod";
import type { Provider } from "./provider.js";
import { rankPrompt } from "./prompts/rank.js";
import type { RankCandidate } from "./prompts/rank.js";
import { parseJsonResponse } from "./json-response.js";

const RankResponseSchema = z.object({ ranked: z.array(z.string()) });

export interface RankedEntry extends RankCandidate {
  rank: number;
}

export interface RankInspectQueueOptions {
  candidates: RankCandidate[];
  provider: Provider;
  promptRev: string;
}

/** Orders changed units by what a human should look at first — the Interpreter's judgment, not a sort by risk.score. See analyze.md#rank-is-not-score. */
export async function rankInspectQueue(options: RankInspectQueueOptions): Promise<RankedEntry[]> {
  const { candidates, provider } = options;
  if (candidates.length === 0) return [];

  const byId = new Map(candidates.map((c) => [c.unit, c]));
  const prompt = rankPrompt(candidates);
  const { text } = await provider.interpret(prompt);

  const parsed = parseJsonResponse(text, "rank inspect queue");
  const response = RankResponseSchema.parse(parsed);

  const rankedIds = new Set(response.ranked);
  if (rankedIds.size !== byId.size || [...byId.keys()].some((id) => !rankedIds.has(id))) {
    throw new Error(
      `rank inspect queue: provider's ranked list does not match the candidate set exactly (expected ${[...byId.keys()].sort().join(", ")}, got ${response.ranked.sort().join(", ")})`,
    );
  }

  return response.ranked.map((unit, i) => ({ ...byId.get(unit)!, rank: i + 1 }));
}

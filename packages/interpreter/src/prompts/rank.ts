export interface RankCandidate {
  unit: string;
  qualname: string;
  status: string;
  score: number;
  confidence: number;
  blastRadius: { direct: number; transitive: number; public_api: boolean };
  why: string;
}

/** Inspect-queue ranking prompt: order changed units by what a human should look at first — not by risk score. See analyze.md#rank-is-not-score. */
export function rankPrompt(candidates: RankCandidate[]): string {
  const lines = candidates
    .map(
      (c, i) =>
        `${i + 1}. ${c.unit} (${c.qualname}) — status ${c.status}, risk ${c.score.toFixed(2)}, confidence ${c.confidence.toFixed(2)}, blast radius ${c.blastRadius.direct} direct / ${c.blastRadius.transitive} transitive${c.blastRadius.public_api ? ", public API" : ""}\n   why: ${c.why}`,
    )
    .join("\n");

  return `You are ranking a list of changed code units for a human reviewer who can only look at a few of them. Order is deliberately NOT the same as sorting by risk score.

A low-scoring, low-confidence change whose blast radius the analyzer cannot fully see is often worth more attention than a known, well-understood medium-risk change — an unknown deserves scrutiny that a knowable risk does not. Weigh confidence and observability, not just the score.

Candidates:
${lines}

Respond with JSON only, matching exactly this shape:
{
  "ranked": ["unit-id-most-important-first", "unit-id-second", ...]
}

Every unit id listed above must appear exactly once, in your chosen order. No prose outside the JSON object.`;
}

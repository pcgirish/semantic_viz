export interface PassDContext {
  qualname: string;
  status: string;
  what: string | null;
  why: string | null;
  blastRadius: { direct: number; transitive: number; public_api: boolean };
  amount: number;
}

/** Pass D prompt: risk narration for one unit whose semantics changed. See analyze.md#4. */
export function passDPrompt(context: PassDContext): string {
  return `You are assessing the risk of a single change to a codebase unit, for a human who has not read the diff.

Unit: ${context.qualname}
Change status: ${context.status}
What it does: ${context.what ?? "(unknown — not yet lifted)"}
Why it exists: ${context.why ?? "(unknown — not yet lifted)"}
Change magnitude (0-1): ${context.amount}
Blast radius: ${context.blastRadius.direct} direct callers, ${context.blastRadius.transitive} transitive, public API: ${context.blastRadius.public_api}

Score five independent risk axes, each 0.0-1.0. They are independent: a change can be safe functionally but catastrophic for availability, or vice versa.

Respond with JSON only, matching exactly this shape:
{
  "axes": {
    "functionality": 0.0-1.0,
    "availability": 0.0-1.0,
    "scalability": 0.0-1.0,
    "performance": 0.0-1.0,
    "security": 0.0-1.0
  },
  "why": "one or two sentences on the single most important risk here",
  "confidence": 0.0-1.0
}

No prose outside the JSON object.`;
}

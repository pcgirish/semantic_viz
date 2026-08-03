import type { CallEdge } from "../checker.js";

export interface FlowUnitSummary {
  id: string;
  qualname: string;
  what: string;
}

/** Pass C prompt: propose api_flow entry points from unit one-liners and the call graph. See analyze.md#2. */
export function passCEntryPointsPrompt(units: FlowUnitSummary[], callEdges: CallEdge[]): string {
  const unitLines = units.map((u) => `- ${u.id} (${u.qualname}): ${u.what || "(no summary)"}`).join("\n");
  const edgeLines = callEdges.map((e) => `${e.from} -> ${e.to}`).join("\n");

  return `You are identifying api_flow entry points in a codebase — units where an external request first enters the system (an HTTP route handler, a CLI command, a queue consumer), starting a call chain worth tracing end to end.

Units (${units.length} total):
${unitLines}

Call edges:
${edgeLines || "(none)"}

Rules:
- Only propose units from the list above, using their exact id.
- Only propose units that plausibly start a request — not every function is an entry point.
- Give each a short "name" (e.g. "POST /orders") and, if you can tell from the summaries, a "route" string; if no route is discernible, reuse the name as the route.

Respond with JSON only, matching exactly this shape:
{
  "flows": [
    { "unit": "u:...", "name": "POST /orders", "route": "POST /orders" }
  ]
}

No prose outside the JSON object.`;
}

export interface FlowStepSummary {
  qualname: string;
  what: string;
}

/** Pass C prompt: narrate a traced api_flow's steps into what/how/when/where/why. See analyze.md#2. */
export function passCFlowNarrationPrompt(route: string, name: string, steps: FlowStepSummary[]): string {
  const stepLines = steps.map((s, i) => `${i + 1}. ${s.qualname}: ${s.what || "(no summary)"}`).join("\n");

  return `You are describing an api_flow named "${name}" (route "${route}"), traced through the following ordered call chain:

${stepLines}

Respond with JSON only, matching exactly this shape. Each field is a distinct one-sentence
answer — do not repeat one field's text in another:
{
  "what": "what this flow accomplishes end to end, one sentence",
  "how": "how the steps connect, one sentence",
  "when": "when this flow runs / is triggered, one sentence",
  "where": "where the flow crosses from one part of the system to another, one sentence",
  "why": "why this flow matters or what risk it carries — the one thing static analysis cannot tell you",
  "tags": ["hot-path", "public-api"],
  "confidence": 0.0-1.0
}

No prose outside the JSON object.`;
}

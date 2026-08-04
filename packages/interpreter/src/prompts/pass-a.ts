import type { SymbolUnit } from "@scv/extractor";

const MAX_GRAPH_CONTEXT_ITEMS = 8;

function formatQualnameList(label: string, qualnames: string[]): string {
  if (qualnames.length === 0) return "";
  const shown = qualnames.slice(0, MAX_GRAPH_CONTEXT_ITEMS);
  const remainder = qualnames.length - shown.length;
  const list = shown.join(", ") + (remainder > 0 ? `, +${remainder} more` : "");
  return `${label}: ${list}\n`;
}

/** Pass A prompt: leaf semantics for one function or class. See analyze.md#2. */
export function passAPrompt(unit: SymbolUnit, source: string, callers: string[] = [], callees: string[] = []): string {
  const graphContext = formatQualnameList("Callers", callers) + formatQualnameList("Callees", callees);

  return `You are analyzing a single ${unit.kind} from a codebase to produce structured semantics.

Unit: ${unit.qualname}
Language: ${unit.lang}
File: ${unit.loc.file}
${graphContext}
Source:
\`\`\`
${source}
\`\`\`

Respond with JSON only, matching exactly this shape:
{
  "what": "what it does, one sentence",
  "how": "how it does it, one sentence",
  "when": "when it runs / is called, one sentence",
  "where": "where it sits in the system, one sentence",
  "why": "why it exists — the one thing static analysis cannot tell you",
  "confidence": 0.0-1.0,
  "ports": {
    "in": [{ "name": "...", "type": "...", "description": "..." }],
    "out": [{ "name": "...", "type": "...", "description": "..." }]
  },
  "cost": {
    "complexity": 1-13,
    "io": ["redis", "postgres", "http", ...],
    "estimate": "one sentence describing the runtime cost",
    "confidence": 0.0-1.0
  },
  "tags": ["short-kebab-tags", ...]
}

No prose outside the JSON object.`;
}

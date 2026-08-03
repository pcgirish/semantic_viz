/** Pass C prompt: narrate why one cluster of files exists as a system-level layer. See analyze.md#2. */
export function passCPrompt(name: string, files: string[], oneLiners: Record<string, string>): string {
  const fileLines = files.map((f) => `- ${f}: ${oneLiners[f] ?? "(no summary)"}`).join("\n");

  return `You are describing why the following cluster of files, named "${name}", exists as a layer in the system's architecture.

Files in this cluster:
${fileLines}

Respond with JSON only, matching exactly this shape. Each field is a distinct one-sentence
answer — do not repeat one field's text in another:
{
  "what": "what this layer does, one sentence",
  "how": "how it does it, one sentence",
  "when": "when it runs / is invoked, one sentence",
  "where": "where it sits in the system relative to other layers, one sentence",
  "why": "why it exists — the one thing static analysis cannot tell you",
  "confidence": 0.0-1.0
}

No prose outside the JSON object.`;
}

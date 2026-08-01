/** Strips a ```json ... ``` (or bare ```) fence some models wrap JSON in despite instructions not to. */
export function stripCodeFence(text: string): string {
  const match = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/.exec(text.trim());
  return match ? match[1]! : text;
}

/** Parses a provider's JSON response, tolerating a markdown code fence, with a labeled error on failure. */
export function parseJsonResponse(text: string, label: string): unknown {
  try {
    return JSON.parse(stripCodeFence(text));
  } catch {
    throw new Error(`${label}: provider returned non-JSON output: ${text.slice(0, 200)}`);
  }
}

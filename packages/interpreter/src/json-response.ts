/** Strips a ```json ... ``` (or bare ```) fence some models wrap JSON in despite instructions not to, tolerating prose before/after the fence and an unclosed fence from a truncated response. */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const opened = /```(?:json)?\s*\n/.exec(trimmed);
  if (!opened) return trimmed;

  const afterOpen = trimmed.slice(opened.index + opened[0].length);
  const closeIndex = afterOpen.indexOf("```");
  return closeIndex === -1 ? afterOpen : afterOpen.slice(0, closeIndex).trim();
}

/** Finds the first balanced `{...}` or `[...]` in text, ignoring braces/brackets inside string literals. Guards against a response ending mid-JSON (still balanced up to the cutoff) or trailing prose after valid JSON. */
function extractBalancedJson(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start === -1) return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") {
      stack.pop();
      if (stack.length === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Parses a provider's JSON response, tolerating a markdown code fence (open, closed, or truncated) and surrounding prose, with a labeled error on failure. */
export function parseJsonResponse(text: string, label: string): unknown {
  const candidate = extractBalancedJson(stripCodeFence(text)) ?? stripCodeFence(text);
  try {
    return JSON.parse(candidate);
  } catch {
    throw new Error(`${label}: provider returned non-JSON output: ${text.slice(0, 200)}`);
  }
}

/** Strips a ```json ... ``` (or bare ```) fence some models wrap JSON in despite instructions not to, tolerating prose before/after the fence and an unclosed fence from a truncated response. */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const opened = /```(?:json)?\s*\n/.exec(trimmed);
  if (!opened) return trimmed;

  const afterOpen = trimmed.slice(opened.index + opened[0].length);
  const closeIndex = afterOpen.indexOf("```");
  return closeIndex === -1 ? afterOpen : afterOpen.slice(0, closeIndex).trim();
}

/**
 * Finds every top-level balanced `{...}`/`[...]` block in text, ignoring braces/brackets inside
 * string literals. A reasoning model's response often contains an earlier draft or example JSON
 * inside its "thinking" prose before the real answer, so callers should prefer the last candidate,
 * not the first.
 */
function findBalancedJsonBlocks(text: string): string[] {
  const blocks: string[] = [];
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const start = text.slice(searchFrom).search(/[[{]/);
    if (start === -1) break;
    const absStart = searchFrom + start;

    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let i = absStart; i < text.length; i++) {
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
        if (stack.length === 0) {
          end = i;
          break;
        }
      }
    }

    if (end === -1) break;
    blocks.push(text.slice(absStart, end + 1));
    searchFrom = end + 1;
  }

  return blocks;
}

/**
 * Repairs `"key", "value"` where a model wrote a comma instead of a colon after an object key,
 * at the start of a line (optionally indented). Tracks bracket depth so it never touches a
 * string array's element-separating commas (e.g. `"tags": ["hot-path", "public-api"]`), which
 * match the same textual shape but are correct JSON.
 */
function repairKeyValueComma(text: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let out = "";

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();

    if (ch === "," && stack[stack.length - 1] === "{") {
      const beforeMatch = /^[ \t]*"(?:[^"\\]|\\.)*"$/.exec(out.slice(out.lastIndexOf("\n") + 1));
      const afterMatch = /^\s*"/.exec(text.slice(i + 1));
      if (beforeMatch && afterMatch) {
        out += ":";
        continue;
      }
    }

    out += ch;
  }

  return out;
}

function tryParse(candidate: string): unknown | undefined {
  try {
    return JSON.parse(candidate);
  } catch {
    try {
      return JSON.parse(repairKeyValueComma(candidate));
    } catch {
      return undefined;
    }
  }
}

/** Parses a provider's JSON response, tolerating a markdown code fence (open, closed, or truncated) and surrounding reasoning-model prose, with a labeled error on failure. Prefers the last well-formed JSON block, since a model's final answer follows any drafts in its "thinking" text. */
export function parseJsonResponse(text: string, label: string): unknown {
  const stripped = stripCodeFence(text);
  const blocks = findBalancedJsonBlocks(stripped);

  for (let i = blocks.length - 1; i >= 0; i--) {
    const parsed = tryParse(blocks[i]!);
    if (parsed !== undefined) return parsed;
  }

  const parsed = tryParse(stripped);
  if (parsed !== undefined) return parsed;

  throw new Error(`${label}: provider returned non-JSON output: ${text.slice(0, 2000)}`);
}

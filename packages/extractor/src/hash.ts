import { createHash } from "node:crypto";

export function shortHash(input: string, len = 12): string {
  return createHash("sha1").update(input).digest("hex").slice(0, len);
}

export function normalizeSource(src: string): string {
  return src
    .split("\n")
    .map((line) => line.split("#")[0]?.trimEnd() ?? "")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split(/\s+/).filter(Boolean).join(" "))
    .join("\n");
}

export function sloc(src: string): number {
  let n = 0;
  for (const line of src.split("\n")) {
    const s = line.trim();
    if (s.length > 0 && !s.startsWith("#")) n++;
  }
  return n;
}

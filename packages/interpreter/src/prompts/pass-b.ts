import type { ImportEdge } from "../checker.js";

/** Pass B prompt: propose non-directory-shaped clusters from file one-liners and the import graph. See analyze.md#2. */
export function passBPrompt(files: string[], oneLiners: Record<string, string>, edges: ImportEdge[]): string {
  const fileLines = files.map((f) => `- ${f}: ${oneLiners[f] ?? "(no summary)"}`).join("\n");
  const edgeLines = edges.map((e) => `${e.from} -> ${e.to} (weight ${e.weight})`).join("\n");

  return `You are grouping the files of a codebase into modules/layers based on how they actually depend on each other, not their directory layout.

Files (${files.length} total — every single one must be placed):
${fileLines}

Import edges:
${edgeLines || "(none)"}

Rules:
- EVERY file listed above must appear in exactly one cluster. Do not skip any file, including ones with no import edges — a file with no edges still belongs somewhere (often alongside files in the same directory, unless a stronger import relationship says otherwise).
- Do not invent files that aren't listed above.
- Prefer cuts that minimize import edges crossing between clusters — group files that import each other, even if they live in different directories.
- Give each cluster a short, meaningful name (e.g. "ops", "api", "orders"), not a directory path.
- Before answering, count the files across all your clusters and confirm it equals ${files.length}.

Respond with JSON only, matching exactly this shape:
{
  "clusters": {
    "cluster-name": ["file/path/one.py", "file/path/two.py"]
  }
}

No prose outside the JSON object.`;
}

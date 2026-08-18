import type { ImportEdge } from "../checker.js";

const MIN_TARGET_CLUSTERS = 2;
const MAX_TARGET_CLUSTERS = 12;

function targetClusterCount(fileCount: number): number {
  return Math.min(MAX_TARGET_CLUSTERS, Math.max(MIN_TARGET_CLUSTERS, Math.round(Math.sqrt(fileCount))));
}

function formatRepoContext(repoContext?: string): string {
  if (!repoContext) return "";
  return `## Repo context (docs + directory structure)\n${repoContext}\n\n`;
}

/** Pass B prompt: propose non-directory-shaped clusters from file one-liners and the import graph. See analyze.md#2. */
export function passBPrompt(files: string[], oneLiners: Record<string, string>, edges: ImportEdge[], repoContext?: string): string {
  const fileLines = files.map((f) => `- ${f}: ${oneLiners[f] ?? "(no summary)"}`).join("\n");
  const edgeLines = edges.map((e) => `${e.from} -> ${e.to} (weight ${e.weight})`).join("\n");
  const target = targetClusterCount(files.length);

  return `You are grouping the files of a codebase into modules/layers based on how they actually depend on each other, not their directory layout.

${formatRepoContext(repoContext)}Files (${files.length} total — every single one must be placed):
${fileLines}

Import edges:
${edgeLines || "(none)"}

Rules:
- EVERY file listed above must appear in exactly one cluster. Do not skip any file, including ones with no import edges — a file with no edges still belongs somewhere (often alongside files in the same directory, unless a stronger import relationship says otherwise).
- Do not invent files that aren't listed above.
- Prefer cuts that minimize import edges crossing between clusters — group files that import each other, even if they live in different directories.
- If the repo context above names a module whose files/paths match files in the list, prefer grouping them accordingly — but only when it doesn't conflict with what the import edges show.
- Give each cluster a short, meaningful name (e.g. "ops", "api", "orders"), not a directory path.
- Aim for roughly ${target} clusters (not a hard requirement — deviate if the import graph clearly calls for more or fewer), given ${files.length} files.
- Before answering, count the files across all your clusters and confirm it equals ${files.length}.

Respond with JSON only, matching exactly this shape:
{
  "clusters": {
    "cluster-name": ["file/path/one.py", "file/path/two.py"]
  }
}

No prose outside the JSON object.`;
}

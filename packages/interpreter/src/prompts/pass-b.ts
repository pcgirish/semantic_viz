import type { ImportEdge } from "../checker.js";
import { directoryClusters } from "../checker.js";

function formatRepoContext(repoContext?: string): string {
  if (!repoContext) return "";
  return `## Repo context (docs + directory structure)\n${repoContext}\n\n`;
}

/** Aggregates file-level ImportEdge[] up to directory-level edges. */
function directoryEdges(files: string[], edges: ImportEdge[]): ImportEdge[] {
  const dirOf = new Map<string, string>();
  for (const file of files) {
    const slash = file.lastIndexOf("/");
    const dir = slash === -1 ? "." : file.slice(0, slash);
    dirOf.set(file, dir);
  }

  const weightByPair = new Map<string, number>();
  for (const edge of edges) {
    const fromDir = dirOf.get(edge.from);
    const toDir = dirOf.get(edge.to);
    if (!fromDir || !toDir || fromDir === toDir) continue;
    const key = `${fromDir} ${toDir}`;
    weightByPair.set(key, (weightByPair.get(key) ?? 0) + edge.weight);
  }

  const result: ImportEdge[] = [];
  for (const [key, weight] of weightByPair) {
    const [from, to] = key.split(" ") as [string, string];
    result.push({ from, to, weight });
  }
  return result;
}

/**
 * Pass B prompt: ask the LLM to propose merges of directory-based base partitions.
 * Base directories are shown with their files and summaries; the LLM's job is to
 * propose which directories should be combined into semantically-named groups.
 * Omitted directories implicitly stay as singleton clusters under their own name.
 */
export function passBPrompt(files: string[], oneLiners: Record<string, string>, edges: ImportEdge[], repoContext?: string): string {
  const baseClusters = directoryClusters(files);
  const baseEdges = directoryEdges(files, edges);

  const dirLines = Object.entries(baseClusters)
    .map(([dir, dirFiles]) => {
      const dirSummary = dirFiles.map((f) => oneLiners[f] ?? "(no summary)").join("; ");
      return `- ${dir}: ${dirSummary}`;
    })
    .join("\n");

  const edgeLines = baseEdges.map((e) => `${e.from} -> ${e.to} (weight ${e.weight})`).join("\n");

  return `You are grouping a codebase's directories into named modules/layers based on how they depend on each other and their purpose.

${formatRepoContext(repoContext)}Base directories (${Object.keys(baseClusters).length} total):
${dirLines}

Directory dependency edges:
${edgeLines || "(none)"}

Rules:
- You are NOT re-partitioning all files from scratch. Instead, propose which base directories above should be MERGED into a single semantically-named group. Your task is to propose which directories to merge.
- Directories you don't mention in a merge implicitly stay as singleton clusters under their own directory name — they are not omitted, simply left unmerged. This ensures every directory and every file lands in exactly one cluster.
- Do not invent directories. Only reference directories listed above.
- Prefer merges that align with the dependency edges — group directories that depend on each other into the same group.
- Naming: if a directory name or a module name from the repo context plausibly describes a merged group's purpose, reuse that name verbatim — do not paraphrase or invent a new one. Only invent a new short name when nothing in the repo context or directory names reasonably fits. Never include generic architecture-speak words in the name itself — "core", "domain", "cluster", "layer", "module", "component" — even as a suffix (e.g. "billing_cluster" is WRONG; use "billing"). Favor names that already appear in this codebase's own directories or docs. A group's name must NEVER be identical to any of the base directory names being merged into it — that would create a collision where the group and its member have the same name.

Respond with JSON only, matching exactly this shape:
{
  "merges": {
    "grouped-name": ["dir1", "dir2"]
  }
}

No prose outside the JSON object.`;
}

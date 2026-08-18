import type { ImportEdge } from "../checker.js";

function formatRepoContext(repoContext?: string): string {
  if (!repoContext) return "";
  return `## Repo context (docs + directory structure)\n${repoContext}\n\n`;
}

/** Pass C groups prompt: bucket Pass B/C layers into a small number of named architectural groups. */
export function passCGroupsPrompt(
  layers: { name: string; why: string }[],
  edges: ImportEdge[],
  repoContext?: string,
): string {
  const layerLines = layers.map((l) => `- ${l.name}: ${l.why}`).join("\n");
  const edgeLines = edges.map((e) => `${e.from} -> ${e.to} (weight ${e.weight})`).join("\n");

  return `You are grouping a codebase's architectural layers into a small number of higher-level groups, based on how they depend on each other and what they do.

${formatRepoContext(repoContext)}Layers (${layers.length} total — every single one must be placed):
${layerLines}

Layer dependency edges:
${edgeLines || "(none)"}

Rules:
- EVERY layer listed above must appear in exactly one group. Do not skip any layer.
- Do not invent layers that aren't listed above.
- Target a small number of groups (3-6), not one group per layer.
- Naming: if a directory name or a module name from the repo context plausibly covers a group's layers, reuse that name verbatim — do not paraphrase or invent a new one. Only invent a new short name when nothing in the repo context reasonably fits. Avoid abstract architecture-speak (e.g. do not default to generic labels like "core" or "domain") — favor names that already appear in this codebase's own directories or docs.
- Prefer grouping layers that depend heavily on each other into the same group.

Respond with JSON only, matching exactly this shape:
{
  "groups": {
    "group-name": ["layerNameA", "layerNameB"]
  }
}

No prose outside the JSON object.`;
}

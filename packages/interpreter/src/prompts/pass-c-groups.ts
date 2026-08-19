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
- Naming: if a directory name or a module name from the repo context plausibly covers a group's layers, reuse that name verbatim — do not paraphrase or invent a new one. Only invent a new short name when nothing in the repo context reasonably fits. Never include generic architecture-speak words in the name itself — "core", "domain", "cluster", "layer", "module", "component" — even as a suffix (e.g. "billing_cluster" is WRONG; use "billing"). Favor names that already appear in this codebase's own directories or docs. A group's name must NEVER be identical to the name of one of the layers listed above being placed into it or any other group — e.g. if a layer is named "orders", no group (whether or not it contains that layer) may also be named "orders"; pick a different, still-verbatim-from-the-repo name, or fall back to a short invented one.
- Prefer grouping layers that depend heavily on each other into the same group.

Respond with JSON only, matching exactly this shape:
{
  "groups": {
    "billing": ["layerNameA", "layerNameB"]
  }
}

No prose outside the JSON object.`;
}

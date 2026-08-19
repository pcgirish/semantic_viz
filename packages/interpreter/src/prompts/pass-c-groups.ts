import type { ImportEdge } from "../checker.js";

function formatRepoContext(repoContext?: string): string {
  if (!repoContext) return "";
  return `## Repo context (docs + directory structure)\n${repoContext}\n\n`;
}

/**
 * Pass C groups prompt: ask the LLM to propose merges of layer-based base partitions.
 * Each layer is shown as a singleton; the LLM's job is to propose which layers
 * should be merged into semantically-named groups. Omitted layers stay as singleton groups.
 */
export function passCGroupsPrompt(
  layers: { name: string; why: string }[],
  edges: ImportEdge[],
  repoContext?: string,
): string {
  const layerLines = layers.map((l) => `- ${l.name}: ${l.why}`).join("\n");
  const edgeLines = edges.map((e) => `${e.from} -> ${e.to} (weight ${e.weight})`).join("\n");

  return `You are proposing merges of a codebase's architectural layers into a small number of higher-level groups, based on how they depend on each other and their purpose.

${formatRepoContext(repoContext)}Base layers (${layers.length} total):
${layerLines}

Layer dependency edges:
${edgeLines || "(none)"}

Rules:
- You are NOT freely partitioning all layers from scratch. Instead, propose which base layers above should be MERGED into a single semantically-named group. Your task is to propose which layers to merge.
- Layers you don't mention in a merge implicitly stay as singleton groups under their own layer name — they are not omitted, simply left unmerged. This ensures every layer lands in exactly one group.
- Do not invent layers. Only reference layers listed above.
- Prefer merges that align with the dependency edges — group layers that depend on each other into the same group.
- Do NOT merge every layer into a single group. A group spanning nearly all layers destroys the distinction between them and is as useless as no grouping at all — propose several smaller, cohesive groups instead, each sharing a clear purpose or tight dependency relationship. Most groups should have 2-4 member layers.
- An empty merges map is only correct if no two layers are meaningfully related — with ${layers.length} layers and the dependency edges above, look for at least one real merge opportunity before concluding none exist.
- Naming: if a directory name or a module name from the repo context plausibly describes a merged group's purpose, reuse that name verbatim — do not paraphrase or invent a new one. Only invent a new short name when nothing in the repo context reasonably fits. Never include generic architecture-speak words in the name itself — "core", "domain", "cluster", "layer", "module", "component" — even as a suffix (e.g. "billing_cluster" is WRONG; use "billing"). Favor names that already appear in this codebase's own directories or docs. A group's name must NEVER be identical to any of the base layer names being merged into it — that would create a collision where the group and its member have the same name.

Respond with JSON only, matching exactly this shape:
{
  "merges": {
    "grouped-name": ["layerNameA", "layerNameB"]
  }
}

No prose outside the JSON object.`;
}

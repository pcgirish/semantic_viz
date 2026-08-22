function formatRepoContext(repoContext?: string): string {
  if (!repoContext) return "";
  return `## Repo context (docs + directory structure)\n${repoContext}\n\n`;
}

export interface PassCPromptOptions {
  /** Map key on our side only — deliberately never rendered into the prompt. */
  layerId: string;
  files: string[];
  oneLiners: Record<string, string>;
  repoContext?: string;
}

/**
 * Pass C prompt: name one cluster of files and narrate why it exists as a layer.
 *
 * Naming moved here from Pass B (plan 4c): membership is now computed deterministically, so
 * Pass B has no name to offer, and Pass C already sees more evidence than Pass B ever did —
 * the member files and their one-liners rather than a directory listing. `layerId` is not
 * interpolated anywhere: it is a sha1 hex slice, and showing it as the cluster's "name" would
 * poison the naming answer being asked for. See analyze.md#2.
 */
export function passCPrompt({ files, oneLiners, repoContext }: PassCPromptOptions): string {
  const fileLines = files.map((f) => `- ${f}: ${oneLiners[f] ?? "(no summary)"}`).join("\n");

  return `You are naming and describing a cluster of files that together form one layer in the system's architecture.

${formatRepoContext(repoContext)}Files in this cluster:
${fileLines}

Name the layer after what these files do, not after where they sit on disk. The name must be a
short lowercase identifier of at most 40 characters, words separated by underscores, and must not
end in "layer", "module", "component", "core", "domain", or "cluster".

Respond with JSON only, matching exactly this shape. Each field is a distinct one-sentence
answer — do not repeat one field's text in another:
{
  "name": "short lowercase name for this layer",
  "what": "what this layer does, one sentence",
  "how": "how it does it, one sentence",
  "when": "when it runs / is invoked, one sentence",
  "where": "where it sits in the system relative to other layers, one sentence",
  "why": "why it exists — the one thing static analysis cannot tell you",
  "confidence": 0.0-1.0
}

No prose outside the JSON object.`;
}

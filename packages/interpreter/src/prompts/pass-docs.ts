/** Pass Docs prompt: extract clustering-relevant structure from one repo doc. See analyze.md#2. */
export function passDocsPrompt(path: string, content: string): string {
  return `You are extracting structural signal from a single documentation file in a codebase, to help later group source files into modules.

Doc path: ${path}

Content:
\`\`\`
${content}
\`\`\`

Extract only what's useful for clustering/narrating the codebase's modules:
- The doc's overall purpose, in one sentence.
- Any named modules/components/layers the doc describes, each with a short description. If the
  doc names a directory or file path for a module, include it in "paths"; if it only names a
  role or concept (e.g. "the ingestion layer") without a path, leave "paths" empty.
- Short architecture notes: layering, boundaries, data flow, etc.

Many docs (e.g. CONTRIBUTING.md, a changelog) have no module or architecture content at all —
that's a valid outcome. In that case return empty arrays for "modules" and "architecture_notes"
rather than inventing structure that isn't there.

Respond with JSON only, matching exactly this shape:
{
  "purpose": "one sentence, what the system/doc is about",
  "modules": [
    { "name": "...", "description": "...", "paths": ["dir/or/file", ...] }
  ],
  "architecture_notes": ["short bullet points on layering, boundaries, data flow, etc."]
}

No prose outside the JSON object.`;
}

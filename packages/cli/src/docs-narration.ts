/**
 * Whether the `docs` artifact really narrates the repo's discovered docs, for the
 * `agent-analyze-clusters` pre-flight check. Pass B is deterministic but consumes `docs`, so
 * clustering over dropped docs silently produces poor groupings.
 *
 * `DocExtract` has no provenance field, so `docs.json === []` is ambiguous on its own: it is
 * equally a faithful narration of a repo with no docs and a `--no-llm` empty default. The
 * discovered-doc count disambiguates without a schema change to a persisted artifact.
 */
export type DocsNarrationStatus = "narrated" | "none-discovered" | "absent" | "defaulted" | "partial";

export interface DocsNarrationInput {
  /** Paths from `discoverDocs`, the same set the `docs` input hash is computed over. */
  discoveredPaths: string[];
  /** The `docs` artifact's extracts, or undefined when the artifact does not exist. */
  docs: { path: string }[] | undefined;
}

export interface DocsNarrationResult {
  status: DocsNarrationStatus;
  /** True when the chain must stop and `agent-analyze-docs` must run first. */
  halt: boolean;
  /** Discovered docs with no extract, in discovery order, so the fix is mechanical. */
  missingPaths: string[];
}

export function classifyDocsNarration(input: DocsNarrationInput): DocsNarrationResult {
  // A repo with no docs is a legitimate shape, not a failure: there is no action the user could
  // take, so the chain continues rather than warning.
  if (input.discoveredPaths.length === 0) return { status: "none-discovered", halt: false, missingPaths: [] };

  if (input.docs === undefined) return { status: "absent", halt: true, missingPaths: [...input.discoveredPaths] };

  const narrated = new Set(input.docs.map((d) => d.path));
  const missingPaths = input.discoveredPaths.filter((p) => !narrated.has(p));
  if (missingPaths.length === 0) return { status: "narrated", halt: false, missingPaths: [] };
  if (narrated.size === 0) return { status: "defaulted", halt: true, missingPaths };
  return { status: "partial", halt: false, missingPaths };
}

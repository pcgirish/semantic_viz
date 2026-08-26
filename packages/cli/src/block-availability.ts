import type { SymbolBlockGraph } from "@scv/extractor";

/**
 * What the `agent-analyze-structure` skill reports about the Flowchart view's data after an
 * analysis. Block units are pure AST structure, so on a live source their absence is either a
 * legitimate repo shape or a real failure — and those must not be reported the same way.
 */
export type BlockAvailability = "populated" | "no-branching" | "failed-build" | "historical-unavailable" | "missing-input";

export interface BlockAvailabilityInput {
  /** `kind === "block"` units in the resulting snapshot. */
  blockUnitCount: number;
  /**
   * Declared by the invocation — whether it named a historical sha — never inferred from disk.
   * A missing `extraction.json` is equally consistent with a live analysis that never ran, was
   * interrupted, or had its cache cleared, so artifact *presence* cannot stand in for this.
   */
  source: "live" | "historical";
  /** null when `.scv/artifacts/<sha>/extraction.json` does not exist. */
  extraction: { blockGraph: Record<string, SymbolBlockGraph> } | null;
}

/** A function contributes blocks only if it actually branches; `resolveBlockGraph` still records
 *  entry/exit blocks for straight-line functions, so block *presence* is not branching. */
function hasBranching(blockGraph: Record<string, SymbolBlockGraph>): boolean {
  return Object.values(blockGraph).some((bg) => bg.edges.some((e) => e.edgeType !== "sequential"));
}

export function classifyBlockAvailability(input: BlockAvailabilityInput): BlockAvailability {
  // `graphFromSnapshot` supplies no block graph regardless of what happens to be on disk, so the
  // declared source is decided first and wins outright.
  if (input.source === "historical") return "historical-unavailable";
  if (input.extraction === null) return "missing-input";
  if (input.blockUnitCount > 0) return "populated";
  return hasBranching(input.extraction.blockGraph) ? "failed-build" : "no-branching";
}

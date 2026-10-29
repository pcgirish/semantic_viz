import { describe, expect, it } from "vitest";
import type { SymbolBlockGraph } from "@semviz/extractor";
import { classifyBlockAvailability } from "../src/block-availability.js";

function branchingGraph(): Record<string, SymbolBlockGraph> {
  return {
    "src.orders.create": {
      blocks: [
        { id: "u:block:aaa", blockType: "entry", startLine: 1, endLine: 1, condition: null },
        { id: "u:block:bbb", blockType: "decision", startLine: 2, endLine: 4, condition: "qty > 0" },
      ],
      edges: [
        { from: "u:block:aaa", to: "u:block:bbb", edgeType: "sequential" },
        { from: "u:block:bbb", to: "u:block:aaa", edgeType: "true" },
      ],
    },
  };
}

function sequentialGraph(): Record<string, SymbolBlockGraph> {
  return {
    "src.orders.total": {
      blocks: [
        { id: "u:block:ccc", blockType: "entry", startLine: 1, endLine: 1, condition: null },
        { id: "u:block:ddd", blockType: "exit", startLine: 2, endLine: 2, condition: null },
      ],
      edges: [{ from: "u:block:ccc", to: "u:block:ddd", edgeType: "sequential" }],
    },
  };
}

describe("classifyBlockAvailability", () => {
  it("reports populated when a branching repo built block units", () => {
    expect(
      classifyBlockAvailability({ blockUnitCount: 7, source: "live", extraction: { blockGraph: branchingGraph() } }),
    ).toBe("populated");
  });

  it("reports no-branching for a repo with no branching functions, not an error", () => {
    expect(classifyBlockAvailability({ blockUnitCount: 0, source: "live", extraction: { blockGraph: {} } })).toBe(
      "no-branching",
    );
  });

  it("treats an all-sequential block graph as no-branching", () => {
    expect(
      classifyBlockAvailability({ blockUnitCount: 0, source: "live", extraction: { blockGraph: sequentialGraph() } }),
    ).toBe("no-branching");
  });

  it("reports failed-build when extraction proves branching but no block units were made", () => {
    expect(
      classifyBlockAvailability({ blockUnitCount: 0, source: "live", extraction: { blockGraph: branchingGraph() } }),
    ).toBe("failed-build");
  });

  it("reports historical-unavailable for a historical source with no extraction", () => {
    expect(classifyBlockAvailability({ blockUnitCount: 0, source: "historical", extraction: null })).toBe(
      "historical-unavailable",
    );
  });

  it("reports historical-unavailable even when function units are present", () => {
    expect(classifyBlockAvailability({ blockUnitCount: 12, source: "historical", extraction: null })).toBe(
      "historical-unavailable",
    );
  });

  it("reports missing-input for a live source with no extraction artifact", () => {
    expect(classifyBlockAvailability({ blockUnitCount: 0, source: "live", extraction: null })).toBe("missing-input");
  });

  it("lets the declared historical source win over an extraction artifact on disk", () => {
    expect(
      classifyBlockAvailability({
        blockUnitCount: 0,
        source: "historical",
        extraction: { blockGraph: branchingGraph() },
      }),
    ).toBe("historical-unavailable");
  });

  // Reviews #16/#17: three distinct meanings share `blockUnitCount: 0`. Asserted together so a
  // future simplification cannot collapse them back into one another.
  it("distinguishes all three zero-block-count cases", () => {
    expect(classifyBlockAvailability({ blockUnitCount: 0, source: "live", extraction: { blockGraph: {} } })).toBe(
      "no-branching",
    );
    expect(classifyBlockAvailability({ blockUnitCount: 0, source: "live", extraction: null })).toBe("missing-input");
    expect(classifyBlockAvailability({ blockUnitCount: 0, source: "historical", extraction: null })).toBe(
      "historical-unavailable",
    );
  });
});

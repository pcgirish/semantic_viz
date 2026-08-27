import { extractRepo } from "@scv/extractor";
import type { SymbolGraph } from "@scv/extractor";
import type { Unit } from "@scv/schema";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { buildBlockUnits, type BlockLabelWithProvenance } from "../src/blocks.js";

const orderlyRoot = fileURLToPath(new URL("../../../fixtures/orderly", import.meta.url));

/** The function units the fixture's blockGraph actually covers, shaped the way
 *  `runFunctionsPass` shapes them before it builds blocks. */
function functionUnitsFrom(graph: SymbolGraph): Unit[] {
  return graph.units
    .filter((u) => u.kind === "function")
    .map((u) => ({
      id: u.id,
      kind: "function" as const,
      name: u.name,
      qualname: u.qualname,
      lang: u.lang,
      parent: u.parent ?? null,
      children: [] as string[],
      loc: { files: [u.loc.file], start: u.loc.start, end: u.loc.end, sloc: u.loc.end - u.loc.start + 1 },
      signature: null,
      semantics: null,
      cost: null,
      tags: [] as string[],
      metrics: {},
      authors: undefined,
      hash: { struct: null, text: null, semantic: null },
      provenance: { source: "static" as const },
    })) as unknown as Unit[];
}

describe("buildBlockUnits", () => {
  let graph: SymbolGraph;
  let units: Unit[];
  /** A fixture function with real branching, plus one of its decision blocks. */
  let branchingQualname: string;
  let branchingUnitId: string;

  beforeAll(async () => {
    graph = await extractRepo(orderlyRoot);
    units = functionUnitsFrom(graph);

    const entry = Object.entries(graph.blockGraph).find(([, bg]) =>
      bg.blocks.some((b) => b.blockType === "decision"),
    );
    expect(entry, "fixture must contain a branching function").toBeDefined();
    branchingQualname = entry![0];
    const unit = units.find((u) => u.qualname === branchingQualname);
    expect(unit, "branching function must have a unit").toBeDefined();
    branchingUnitId = unit!.id;
  });

  it("mints a block unit per block and a control_flow edge per edge", () => {
    const { blockUnits, blockEdges } = buildBlockUnits(units, graph);

    const expectedBlocks = Object.values(graph.blockGraph).reduce((n, bg) => n + bg.blocks.length, 0);
    const expectedEdges = Object.values(graph.blockGraph).reduce((n, bg) => n + bg.edges.length, 0);
    expect(expectedBlocks).toBeGreaterThan(0);

    expect(blockUnits).toHaveLength(expectedBlocks);
    expect(blockEdges).toHaveLength(expectedEdges);
    expect(blockUnits.every((u) => u.kind === "block")).toBe(true);
    expect(blockEdges.every((e) => e.kind === "control_flow")).toBe(true);
  });

  it("parents each block under its function and lists it in that function's children", () => {
    const { unitsWithBlockChildren, blockUnits } = buildBlockUnits(units, graph);

    const bg = graph.blockGraph[branchingQualname]!;
    const fn = unitsWithBlockChildren.find((u) => u.id === branchingUnitId)!;
    for (const block of bg.blocks) {
      expect(fn.children).toContain(block.id);
      expect(blockUnits.find((u) => u.id === block.id)?.parent).toBe(branchingUnitId);
    }
  });

  it("falls back to condition text, then a presentable block-type name, and marks them static", () => {
    const { blockUnits } = buildBlockUnits(units, graph);
    const bg = graph.blockGraph[branchingQualname]!;

    const decision = bg.blocks.find((b) => b.blockType === "decision" && b.condition)!;
    expect(blockUnits.find((u) => u.id === decision.id)?.name).toBe(decision.condition);

    const entryBlock = bg.blocks.find((b) => b.blockType === "entry");
    if (entryBlock) expect(blockUnits.find((u) => u.id === entryBlock.id)?.name).toBe("start");

    expect(blockUnits.every((u) => u.provenance?.source === "static")).toBe(true);
  });

  it("applies supplied labels over the fallback and carries their provenance verbatim", () => {
    const bg = graph.blockGraph[branchingQualname]!;
    const decision = bg.blocks.find((b) => b.blockType === "decision")!;

    const provenance = { source: "manual", pass: "A" } as const;
    const labels = new Map<string, Map<string, BlockLabelWithProvenance>>([
      [
        branchingUnitId,
        new Map([
          [decision.id, { label: { label: "rate limit exceeded?", trueLabel: "over", falseLabel: "under" }, provenance }],
        ]),
      ],
    ]);

    const { blockUnits, blockEdges } = buildBlockUnits(units, graph, labels);

    const labeled = blockUnits.find((u) => u.id === decision.id)!;
    expect(labeled.name).toBe("rate limit exceeded?");
    expect(labeled.provenance).toEqual(provenance);

    const trueEdge = blockEdges.find((e) => e.from === decision.id && e.flowType === "true");
    if (trueEdge) expect(trueEdge.edgeLabel).toBe("over");
    const falseEdge = blockEdges.find((e) => e.from === decision.id && e.flowType === "false");
    if (falseEdge) expect(falseEdge.edgeLabel).toBe("under");

    // Unlabeled siblings keep the structural fallback and stay static.
    const other = blockUnits.find((u) => u.id !== decision.id && u.parent === branchingUnitId)!;
    expect(other.provenance).toEqual({ source: "static" });
  });

  it("is deterministic across identical calls", () => {
    const a = buildBlockUnits(units, graph);
    const b = buildBlockUnits(units, graph);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("mints no duplicate unit or edge ids", () => {
    const { blockUnits, blockEdges } = buildBlockUnits(units, graph);
    expect(new Set(blockUnits.map((u) => u.id)).size).toBe(blockUnits.length);
    expect(new Set(blockEdges.map((e) => e.id)).size).toBe(blockEdges.length);
  });

  it("returns nothing for a graph with no block data", () => {
    const empty = { ...graph, blockGraph: {} };
    const { unitsWithBlockChildren, blockUnits, blockEdges } = buildBlockUnits(units, empty);
    expect(blockUnits).toEqual([]);
    expect(blockEdges).toEqual([]);
    expect(unitsWithBlockChildren.every((u) => u.children.length === 0)).toBe(true);
  });
});

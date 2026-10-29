import { createHash } from "node:crypto";
import type { SymbolBlockGraph, SymbolGraph, SymbolUnit } from "@semviz/extractor";
import type { Edge, Unit, UnitProvenance } from "@semviz/schema";
import type { BlockLabel } from "./pass-a-blocks.js";

/** Presentable fallback block names, keyed by BlockType, for when a block has no label —
 *  raw blockType strings like "merge" read as internal debug output on a flowchart. */
const BLOCK_TYPE_FALLBACK_NAME: Record<string, string> = {
  merge: "continue",
  entry: "start",
  exit: "end",
};

/** A label plus where it came from. `BlockLabel` stays the Pass A-blocks LLM response
 *  shape, so it must not grow provenance fields the model is expected to emit. Keeping
 *  them separate is what lets a recovered manual label stay manual and a recovered LLM
 *  label keep its original provider/model rather than being re-stamped. */
export interface BlockLabelWithProvenance {
  label: BlockLabel;
  provenance: UnitProvenance;
}

export interface BuildBlockUnitsResult {
  /** `units` with each function's block ids appended to its `children`. */
  unitsWithBlockChildren: Unit[];
  blockUnits: Unit[];
  blockEdges: Edge[];
}

/**
 * Builds the block units and `control_flow` edges backing the Flowchart view.
 *
 * Block units are pure AST structure — no LLM, layer, or group context is needed — so this
 * runs identically on the real pipeline and on every zero-LLM merge path. Every function
 * unit's `SymbolGraph.blockGraph` entry becomes block Units parented under that function
 * (so blocks appear in its `children`, same as any other nesting in the schema) plus
 * `control_flow` Edges carrying `flowType`.
 *
 * `labels` is the optional Pass A-blocks enhancement, keyed function unit id -> block id.
 * A block with no label falls back to its `condition` text, then a presentable block-type
 * name — the same fallback used when the label call fails.
 */
export function buildBlockUnits(
  units: Unit[],
  graph: SymbolGraph,
  labels?: Map<string, Map<string, BlockLabelWithProvenance>>,
): BuildBlockUnitsResult {
  const graphById = new Map(graph.units.map((u) => [u.id, u]));

  const functionsWithBlocks: { unit: Unit; symbolUnit: SymbolUnit; bg: SymbolBlockGraph }[] = [];
  for (const unit of units) {
    if (unit.kind !== "function") continue;
    const symbolUnit = graphById.get(unit.id);
    if (!symbolUnit) continue;
    const bg = graph.blockGraph[symbolUnit.qualname];
    if (!bg) continue;
    functionsWithBlocks.push({ unit, symbolUnit, bg });
  }

  const blockUnits: Unit[] = [];
  const blockEdges: Edge[] = [];
  const blockChildrenByFunction = new Map<string, string[]>();

  for (const { unit, bg } of functionsWithBlocks) {
    const fnLabels = labels?.get(unit.id);
    const childIds: string[] = [];

    for (const block of bg.blocks) {
      childIds.push(block.id);
      const labeled = fnLabels?.get(block.id);
      blockUnits.push({
        id: block.id,
        kind: "block",
        name: labeled?.label.label ?? block.condition ?? BLOCK_TYPE_FALLBACK_NAME[block.blockType] ?? block.blockType,
        qualname: block.id,
        lang: undefined,
        parent: unit.id,
        children: [],
        loc: { files: unit.loc.files, start: block.startLine, end: block.endLine, sloc: block.endLine - block.startLine + 1 },
        signature: null,
        semantics: null,
        cost: null,
        tags: [],
        metrics: {},
        authors: undefined,
        hash: { struct: null, text: null, semantic: null },
        provenance: labeled ? labeled.provenance : { source: "static" },
      });
    }
    blockChildrenByFunction.set(unit.id, childIds);

    for (const edge of bg.edges) {
      const fromLabel = fnLabels?.get(edge.from)?.label;
      const edgeLabel = edge.edgeType === "true" ? fromLabel?.trueLabel : edge.edgeType === "false" ? fromLabel?.falseLabel : undefined;
      blockEdges.push({
        id: `e:cf:${createHash("sha1").update(`${edge.from}${edge.to}${edge.edgeType}`).digest("hex").slice(0, 10)}`,
        from: edge.from,
        to: edge.to,
        kind: "control_flow",
        weight: 1,
        evidence: [],
        source: "static",
        confidence: 1,
        flowType: edge.edgeType,
        edgeLabel,
        ...(edge.raises ? { raises: true } : {}),
      });
    }
  }

  const unitsWithBlockChildren = units.map((unit) => {
    const childIds = blockChildrenByFunction.get(unit.id);
    if (!childIds) return unit;
    return { ...unit, children: [...unit.children, ...childIds] };
  });

  return { unitsWithBlockChildren, blockUnits, blockEdges };
}

/**
 * Reads labels back out of an already-built block collection.
 *
 * A label is not stored as a separate field — it is baked in as the block unit's `name`,
 * the outgoing edge's `edgeLabel`, and `provenance.source`. So labels in a cached
 * `functions` artifact are recoverable without a pending file, which is what lets a merge
 * that changes only unit semantics preserve existing block labels instead of resetting
 * them to structural text. Provenance is returned verbatim, never re-stamped.
 */
export function recoverBlockLabels(
  blockUnits: Unit[],
  blockEdges: Edge[],
): Map<string, Map<string, BlockLabelWithProvenance>> {
  const trueLabelByBlock = new Map<string, string>();
  const falseLabelByBlock = new Map<string, string>();
  for (const edge of blockEdges) {
    if (edge.edgeLabel === undefined) continue;
    if (edge.flowType === "true") trueLabelByBlock.set(edge.from, edge.edgeLabel);
    else if (edge.flowType === "false") falseLabelByBlock.set(edge.from, edge.edgeLabel);
  }

  const out = new Map<string, Map<string, BlockLabelWithProvenance>>();
  for (const block of blockUnits) {
    // "static" is the structural fallback, not a label worth carrying forward.
    if (block.provenance?.source === undefined || block.provenance.source === "static") continue;
    if (block.parent === null || block.parent === undefined) continue;

    const trueLabel = trueLabelByBlock.get(block.id);
    const falseLabel = falseLabelByBlock.get(block.id);
    const entry: BlockLabelWithProvenance = {
      label: {
        label: block.name,
        ...(trueLabel !== undefined ? { trueLabel } : {}),
        ...(falseLabel !== undefined ? { falseLabel } : {}),
      },
      provenance: block.provenance,
    };

    const forFunction = out.get(block.parent) ?? new Map<string, BlockLabelWithProvenance>();
    forFunction.set(block.id, entry);
    out.set(block.parent, forFunction);
  }
  return out;
}

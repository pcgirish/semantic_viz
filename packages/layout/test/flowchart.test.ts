import { describe, expect, it } from "vitest";
import { buildFlowchartScene } from "../src/flowchart.js";
import type { Edge, Unit } from "@scv/schema";

function makeBlock(overrides: Partial<Unit> & { id: string }): Unit {
  return {
    kind: "block",
    name: overrides.id,
    qualname: overrides.id,
    parent: "u:fn:1",
    children: [],
    loc: { files: [], sloc: 1 },
    tags: [],
    metrics: {},
    hash: { struct: null, text: null, semantic: null },
    provenance: { source: "static" },
    signature: null,
    semantics: null,
    ...overrides,
  };
}

function makeCfEdge(overrides: Partial<Edge> & { id: string; from: string; to: string; flowType: Edge["flowType"] }): Edge {
  return { kind: "control_flow", weight: 1, source: "static", confidence: 1, ...overrides };
}

describe("buildFlowchartScene", () => {
  it("ranks the entry block first and an exit block last", () => {
    const blocks = [
      makeBlock({ id: "entry:0" }),
      makeBlock({ id: "decision:0" }),
      makeBlock({ id: "exit:0" }),
    ];
    const edges = [
      makeCfEdge({ id: "e1", from: "entry:0", to: "decision:0", flowType: "sequential" }),
      makeCfEdge({ id: "e2", from: "decision:0", to: "exit:0", flowType: "true" }),
    ];
    const scene = buildFlowchartScene(blocks, edges);
    const entry = scene.nodes.find((n) => n.id === "entry:0")!;
    const exit = scene.nodes.find((n) => n.id === "exit:0")!;
    expect(entry.y).toBeLessThan(exit.y);
  });

  it("splits if/else branches into adjacent ranks and reconverges at the merge block's rank", () => {
    const blocks = [
      makeBlock({ id: "entry:0" }),
      makeBlock({ id: "decision:0" }),
      makeBlock({ id: "sequential:0" }), // true branch
      makeBlock({ id: "sequential:1" }), // false branch
      makeBlock({ id: "merge:0" }),
    ];
    const edges = [
      makeCfEdge({ id: "e1", from: "entry:0", to: "decision:0", flowType: "sequential" }),
      makeCfEdge({ id: "e2", from: "decision:0", to: "sequential:0", flowType: "true" }),
      makeCfEdge({ id: "e3", from: "decision:0", to: "sequential:1", flowType: "false" }),
      makeCfEdge({ id: "e4", from: "sequential:0", to: "merge:0", flowType: "sequential" }),
      makeCfEdge({ id: "e5", from: "sequential:1", to: "merge:0", flowType: "sequential" }),
    ];
    const scene = buildFlowchartScene(blocks, edges);
    const trueBranch = scene.nodes.find((n) => n.id === "sequential:0")!;
    const falseBranch = scene.nodes.find((n) => n.id === "sequential:1")!;
    const merge = scene.nodes.find((n) => n.id === "merge:0")!;
    expect(trueBranch.y).toBe(falseBranch.y);
    expect(merge.y).toBeGreaterThan(trueBranch.y);
  });

  it("connects a loop body's last block back to the loop block via a loop-back edge", () => {
    const blocks = [
      makeBlock({ id: "entry:0" }),
      makeBlock({ id: "loop:0" }),
      makeBlock({ id: "sequential:0" }),
    ];
    const edges = [
      makeCfEdge({ id: "e1", from: "entry:0", to: "loop:0", flowType: "sequential" }),
      makeCfEdge({ id: "e2", from: "loop:0", to: "sequential:0", flowType: "true" }),
      makeCfEdge({ id: "e3", from: "sequential:0", to: "loop:0", flowType: "loop-back" }),
    ];
    const scene = buildFlowchartScene(blocks, edges);
    const loopBack = scene.links.find((l) => l.flowType === "loop-back");
    expect(loopBack).toBeDefined();
    expect(loopBack!.from).toBe("sequential:0");
    expect(loopBack!.to).toBe("loop:0");
  });

  it("is deterministic — same input twice produces an identical scene", () => {
    const blocks = [makeBlock({ id: "entry:0" }), makeBlock({ id: "exit:0" })];
    const edges = [makeCfEdge({ id: "e1", from: "entry:0", to: "exit:0", flowType: "sequential" })];
    const scene1 = buildFlowchartScene(blocks, edges);
    const scene2 = buildFlowchartScene(blocks, edges);
    expect(scene1).toEqual(scene2);
  });

  it("marks a block with true/false outgoing edges as a decision, labeled with its name", () => {
    const blocks = [
      makeBlock({ id: "entry:0" }),
      makeBlock({ id: "decision:0", name: "x > 0" }),
      makeBlock({ id: "exit:0" }),
      makeBlock({ id: "exit:1" }),
    ];
    const edges = [
      makeCfEdge({ id: "e1", from: "entry:0", to: "decision:0", flowType: "sequential" }),
      makeCfEdge({ id: "e2", from: "decision:0", to: "exit:0", flowType: "true" }),
      makeCfEdge({ id: "e3", from: "decision:0", to: "exit:1", flowType: "false" }),
    ];
    const scene = buildFlowchartScene(blocks, edges);
    const decision = scene.nodes.find((n) => n.id === "decision:0")!;
    expect(decision.blockType).toBe("decision");
    expect(decision.condition).toBe("x > 0");
  });

  it("marks a block with a loop-back edge pointing to it as a loop", () => {
    const blocks = [makeBlock({ id: "entry:0" }), makeBlock({ id: "loop:0" }), makeBlock({ id: "sequential:0" })];
    const edges = [
      makeCfEdge({ id: "e1", from: "entry:0", to: "loop:0", flowType: "sequential" }),
      makeCfEdge({ id: "e2", from: "loop:0", to: "sequential:0", flowType: "true" }),
      makeCfEdge({ id: "e3", from: "sequential:0", to: "loop:0", flowType: "loop-back" }),
    ];
    const scene = buildFlowchartScene(blocks, edges);
    const loop = scene.nodes.find((n) => n.id === "loop:0")!;
    expect(loop.blockType).toBe("loop");
  });

  it("marks a block with no outgoing edges as an exit", () => {
    const blocks = [makeBlock({ id: "entry:0" }), makeBlock({ id: "exit:0" })];
    const edges = [makeCfEdge({ id: "e1", from: "entry:0", to: "exit:0", flowType: "sequential" })];
    const scene = buildFlowchartScene(blocks, edges);
    const exit = scene.nodes.find((n) => n.id === "exit:0")!;
    expect(exit.blockType).toBe("exit");
  });

  it("marks a block with no incoming edges as the entry", () => {
    const blocks = [makeBlock({ id: "entry:0" }), makeBlock({ id: "exit:0" })];
    const edges = [makeCfEdge({ id: "e1", from: "entry:0", to: "exit:0", flowType: "sequential" })];
    const scene = buildFlowchartScene(blocks, edges);
    const entry = scene.nodes.find((n) => n.id === "entry:0")!;
    expect(entry.blockType).toBe("entry");
  });
});

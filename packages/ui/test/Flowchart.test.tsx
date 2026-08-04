import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { Edge, Unit } from "@scv/schema";
import { Flowchart } from "../src/Flowchart.js";

afterEach(cleanup);

function makeUnit(overrides: Partial<Unit> & { id: string }): Unit {
  return {
    kind: "function",
    name: overrides.id,
    qualname: overrides.id,
    parent: null,
    children: [],
    loc: { files: [], sloc: 10 },
    tags: [],
    metrics: {},
    hash: { struct: null, text: null, semantic: null },
    provenance: { source: "static" },
    signature: null,
    semantics: null,
    ...overrides,
  };
}

function makeBlock(overrides: Partial<Unit> & { id: string }): Unit {
  return makeUnit({ kind: "block", ...overrides });
}

function makeCfEdge(overrides: Partial<Edge> & { id: string; from: string; to: string; flowType: Edge["flowType"] }): Edge {
  return { kind: "control_flow", weight: 1, source: "static", confidence: 1, ...overrides };
}

describe("Flowchart", () => {
  it("renders decision nodes for a function with if/else branching", () => {
    const fn = makeUnit({ id: "fn1", kind: "function", children: ["b:entry", "b:dec", "b:t", "b:f", "b:merge"] });
    const units = [
      fn,
      makeBlock({ id: "b:entry" }),
      makeBlock({ id: "b:dec", name: "x > 0" }),
      makeBlock({ id: "b:t" }),
      makeBlock({ id: "b:f" }),
      makeBlock({ id: "b:merge" }),
    ];
    const edges = [
      makeCfEdge({ id: "e1", from: "b:entry", to: "b:dec", flowType: "sequential" }),
      makeCfEdge({ id: "e2", from: "b:dec", to: "b:t", flowType: "true" }),
      makeCfEdge({ id: "e3", from: "b:dec", to: "b:f", flowType: "false" }),
      makeCfEdge({ id: "e4", from: "b:t", to: "b:merge", flowType: "sequential" }),
      makeCfEdge({ id: "e5", from: "b:f", to: "b:merge", flowType: "sequential" }),
    ];

    const { container } = render(<Flowchart functionUnit={fn} units={units} edges={edges} />);

    expect(container.querySelector(".block-diamond")).toBeTruthy();
    expect(container.querySelectorAll("[data-testid='flowchart-svg'] .tile").length).toBe(5);
  });

  it("renders a message, not an empty canvas, for a leaf function with no control flow", () => {
    const fn = makeUnit({ id: "fn1", kind: "function", name: "leaf_fn", children: [] });
    const { container, getByText } = render(<Flowchart functionUnit={fn} units={[fn]} edges={[]} />);

    expect(container.querySelector("[data-testid='flowchart-svg']")).toBeNull();
    expect(getByText(/leaf_fn/)).toBeTruthy();
  });

  it("renders a header with the function's qualname", () => {
    const fn = makeUnit({
      id: "fn1",
      kind: "function",
      qualname: "src.orders.create_order.create_order",
      children: ["b:entry", "b:exit"],
    });
    const units = [fn, makeBlock({ id: "b:entry" }), makeBlock({ id: "b:exit" })];
    const edges = [makeCfEdge({ id: "e1", from: "b:entry", to: "b:exit", flowType: "sequential" })];

    const { getByText } = render(<Flowchart functionUnit={fn} units={units} edges={edges} />);
    expect(getByText("src.orders.create_order.create_order")).toBeTruthy();
  });

  it("shows the route in the header when the function is a step in an api_flow", () => {
    const fn = makeUnit({ id: "fn1", kind: "function", children: ["b:entry", "b:exit"] });
    const flow = makeUnit({ id: "flow1", kind: "api_flow", route: "POST /orders", steps: ["fn1"] });
    const units = [fn, flow, makeBlock({ id: "b:entry" }), makeBlock({ id: "b:exit" })];
    const edges = [makeCfEdge({ id: "e1", from: "b:entry", to: "b:exit", flowType: "sequential" })];

    const { getByText } = render(<Flowchart functionUnit={fn} units={units} edges={edges} />);
    expect(getByText("POST /orders")).toBeTruthy();
  });

  it("omits the route line when the function is not part of any api_flow", () => {
    const fn = makeUnit({ id: "fn1", kind: "function", children: ["b:entry", "b:exit"] });
    const units = [fn, makeBlock({ id: "b:entry" }), makeBlock({ id: "b:exit" })];
    const edges = [makeCfEdge({ id: "e1", from: "b:entry", to: "b:exit", flowType: "sequential" })];

    const { container } = render(<Flowchart functionUnit={fn} units={units} edges={edges} />);
    expect(container.querySelector(".flowchart-header-route")).toBeNull();
  });

  it("filters blocks/edges to only the given function's children, ignoring another function's blocks", () => {
    const fn1 = makeUnit({ id: "fn1", kind: "function", children: ["b1:entry", "b1:exit"] });
    const units = [
      fn1,
      makeBlock({ id: "b1:entry" }),
      makeBlock({ id: "b1:dec", name: "should not appear" }), // belongs to a different function
      makeBlock({ id: "b1:exit" }),
    ];
    const edges = [
      makeCfEdge({ id: "e1", from: "b1:entry", to: "b1:exit", flowType: "sequential" }),
      makeCfEdge({ id: "e2", from: "b1:dec", to: "b1:exit", flowType: "true" }), // noise from another function
    ];

    const { container } = render(<Flowchart functionUnit={fn1} units={units} edges={edges} />);

    expect(container.querySelectorAll("[data-testid='flowchart-svg'] .tile").length).toBe(2);
  });
});

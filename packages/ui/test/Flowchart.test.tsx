import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { Edge, Unit } from "@semviz/schema";
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

  it("renders an exception exit edge in risk styling, distinct from the false/no continuation edge", () => {
    // Mirrors `if not payload.ok: raise ...` with no else: the decision's only two
    // outgoing edges are "exception" (to the raise) and "false" (the implicit
    // no-else continuation) — there is no "true" edge at all.
    const fn = makeUnit({ id: "fn1", kind: "function", children: ["b:entry", "b:dec", "b:exc", "b:cont"] });
    const units = [
      fn,
      makeBlock({ id: "b:entry" }),
      makeBlock({ id: "b:dec", name: "not payload.ok" }),
      makeBlock({ id: "b:exc", name: "raise" }),
      makeBlock({ id: "b:cont" }),
    ];
    const edges = [
      makeCfEdge({ id: "e1", from: "b:entry", to: "b:dec", flowType: "sequential" }),
      makeCfEdge({ id: "e2", from: "b:dec", to: "b:exc", flowType: "exception" }),
      makeCfEdge({ id: "e3", from: "b:dec", to: "b:cont", flowType: "false" }),
    ];

    const { container } = render(<Flowchart functionUnit={fn} units={units} edges={edges} />);

    // ConnectorLayer renders one arrowhead <marker><path> per distinct stroke color inside
    // <defs> before the actual edge <path>s (each with an id="cd-..." set directly on the
    // edge path, unlike marker paths), so filter to those. Edge paths then follow
    // scene.links order, which mirrors cfEdges order: [entry->dec, dec->exc, dec->cont].
    const paths = container.querySelectorAll("[data-testid='flowchart-svg'] path[id^='cd-']");
    const [, excPath, contPath] = Array.from(paths);

    // The exception edge (leads to the raise/exit) must be styled as risk (red);
    // the false edge (leads to the normal continuation) must NOT be risk-colored.
    expect(excPath.getAttribute("stroke")).toBe("var(--temp-6)");
    expect(contPath.getAttribute("stroke")).not.toBe("var(--temp-6)");
  });

  it("renders a branch-conditional raise (true/false edgeType, raises:true) in risk styling, unlike a plain branch return", () => {
    // Mirrors `if not payload.ok: raise ...` reached via an explicit branch (edgeType
    // "true", not "exception") — still an error-exit path and must render red. The
    // sibling "false" branch is a plain return and must stay neutral.
    const fn = makeUnit({ id: "fn1", kind: "function", children: ["b:entry", "b:dec", "b:err", "b:ok"] });
    const units = [
      fn,
      makeBlock({ id: "b:entry" }),
      makeBlock({ id: "b:dec", name: "not payload.ok" }),
      makeBlock({ id: "b:err", name: "raise" }),
      makeBlock({ id: "b:ok" }),
    ];
    const edges: Edge[] = [
      makeCfEdge({ id: "e1", from: "b:entry", to: "b:dec", flowType: "sequential" }),
      { ...makeCfEdge({ id: "e2", from: "b:dec", to: "b:err", flowType: "true" }), raises: true },
      makeCfEdge({ id: "e3", from: "b:dec", to: "b:ok", flowType: "false" }),
    ];

    const { container } = render(<Flowchart functionUnit={fn} units={units} edges={edges} />);

    const paths = container.querySelectorAll("[data-testid='flowchart-svg'] path[id^='cd-']");
    const [, errPath, okPath] = Array.from(paths);

    expect(errPath.getAttribute("stroke")).toBe("var(--temp-6)");
    expect(okPath.getAttribute("stroke")).not.toBe("var(--temp-6)");
  });

  describe("pan/zoom", () => {
    /** A branching function big enough that its scene overflows a small viewport. */
    function branchingFn() {
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
      return { fn, units, edges };
    }

    function extent(container: HTMLElement): HTMLElement {
      return container.querySelector(".canvas-extent") as HTMLElement;
    }

    function stubRect(el: Element, width: number, height: number) {
      el.getBoundingClientRect = () =>
        ({ x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height, toJSON() {} }) as DOMRect;
    }

    it("wheel zooms in: the rendered extent grows on deltaY < 0", () => {
      const { fn, units, edges } = branchingFn();
      const { container } = render(<Flowchart functionUnit={fn} units={units} edges={edges} />);
      const scroll = container.querySelector("[data-testid='flowchart-svg']") as HTMLElement;
      stubRect(scroll, 400, 300);
      const before = extent(container).style.width;

      fireEvent.wheel(scroll, { deltaY: -100, clientX: 100, clientY: 100 });

      expect(parseFloat(extent(container).style.width)).toBeGreaterThan(parseFloat(before) || 0);
    });

    it("wheel zoom-out shrinks the rendered extent, clamped above zero", () => {
      const { fn, units, edges } = branchingFn();
      const { container } = render(<Flowchart functionUnit={fn} units={units} edges={edges} />);
      const scroll = container.querySelector("[data-testid='flowchart-svg']") as HTMLElement;
      stubRect(scroll, 400, 300);
      fireEvent.wheel(scroll, { deltaY: -100, clientX: 100, clientY: 100 });
      const before = parseFloat(extent(container).style.width);

      for (let i = 0; i < 100; i++) {
        fireEvent.wheel(scroll, { deltaY: 100, clientX: 100, clientY: 100 });
      }
      const after = parseFloat(extent(container).style.width);
      expect(after).toBeLessThan(before);
      expect(after).toBeGreaterThan(0);
    });

    it("dragging pans via native scroll", () => {
      const { fn, units, edges } = branchingFn();
      const { container } = render(<Flowchart functionUnit={fn} units={units} edges={edges} />);
      const scroll = container.querySelector("[data-testid='flowchart-svg']") as HTMLDivElement;
      stubRect(scroll, 400, 300);
      scroll.scrollLeft = 50;
      scroll.scrollTop = 50;

      fireEvent.mouseDown(scroll, { clientX: 200, clientY: 200 });
      fireEvent.mouseMove(scroll, { clientX: 150, clientY: 180 });
      fireEvent.mouseUp(scroll, { clientX: 150, clientY: 180 });

      expect(scroll.scrollLeft).not.toBe(50);
      expect(scroll.scrollTop).not.toBe(50);
    });

    it("only shows the scrollbar (via a 'panning' class) while a drag-pan is in progress", () => {
      const { fn, units, edges } = branchingFn();
      const { container } = render(<Flowchart functionUnit={fn} units={units} edges={edges} />);
      const scroll = container.querySelector("[data-testid='flowchart-svg']") as HTMLDivElement;
      stubRect(scroll, 400, 300);

      expect(scroll.classList.contains("panning")).toBe(false);

      fireEvent.mouseDown(scroll, { clientX: 200, clientY: 200 });
      fireEvent.mouseMove(scroll, { clientX: 150, clientY: 180 });
      expect(scroll.classList.contains("panning")).toBe(true);

      fireEvent.mouseUp(scroll, { clientX: 150, clientY: 180 });
      expect(scroll.classList.contains("panning")).toBe(false);
    });

    it("fits an oversized scene into the viewport on first paint", () => {
      const { fn, units, edges } = branchingFn();
      const { container } = render(<Flowchart functionUnit={fn} units={units} edges={edges} />);
      const scaled = container.querySelector(".canvas-scale") as HTMLElement;
      expect(scaled).not.toBeNull();
      expect(scaled.style.transform).toMatch(/^scale\(/);
    });
  });
});

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Edge, Unit } from "@scv/schema";
import { CanvasHost } from "../src/CanvasHost.js";
import { useAppStore } from "../src/store.js";

function makeUnit(overrides: Partial<Unit> & { id: string }): Unit {
  return {
    kind: "module",
    name: overrides.id,
    qualname: overrides.id,
    parent: null,
    children: [],
    loc: { files: [], sloc: 10 },
    tags: [],
    metrics: {},
    hash: { struct: null, text: null, semantic: null },
    provenance: { source: "static" },
    ...overrides,
  };
}

function stubRect(el: Element, width: number, height: number) {
  el.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height, toJSON() {} }) as DOMRect;
}

describe("CanvasHost", () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
  });

  afterEach(() => {
    cleanup();
  });

  it("renders one tile per unit", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    const edges: Edge[] = [{ id: "e1", from: "a", to: "b", kind: "calls", weight: 1, source: "static", confidence: 1 }];
    const { container } = render(<CanvasHost units={units} edges={edges} />);
    expect(container.querySelectorAll(".tile")).toHaveLength(2);
  });

  it("sets --layer-color on a tile whose unit has a layer ancestor", () => {
    const units = [
      makeUnit({ id: "u:layer:abc", kind: "layer", name: "orders" }),
      makeUnit({ id: "a", parent: "u:layer:abc" }),
    ];
    const { container } = render(<CanvasHost units={units} edges={[]} />);
    const tile = container.querySelector('[data-id="a"]') as HTMLElement;
    expect(tile.style.getPropertyValue("--layer-color")).not.toBe("");
    expect(tile.style.getPropertyValue("--layer-color")).not.toBe("var(--ext)");
  });

  it("falls back to var(--ext) for a tile with no layer ancestor", () => {
    const units = [makeUnit({ id: "a" })];
    const { container } = render(<CanvasHost units={units} edges={[]} />);
    const tile = container.querySelector('[data-id="a"]') as HTMLElement;
    expect(tile.style.getPropertyValue("--layer-color")).toBe("var(--ext)");
  });

  it("draws a region behind the node layer for a group with 2+ layers", () => {
    const units = [
      makeUnit({ id: "u:layer:l1", kind: "layer", name: "orders", group: "api surface" }),
      makeUnit({ id: "u:layer:l2", kind: "layer", name: "billing", group: "api surface" }),
      makeUnit({ id: "a", parent: "u:layer:l1" }),
      makeUnit({ id: "b", parent: "u:layer:l2" }),
    ];
    const { container } = render(<CanvasHost units={units} edges={[]} />);
    const regionEls = [...container.querySelectorAll(".region, .tile")];
    const regionIndex = regionEls.findIndex((el) => el.classList.contains("region"));
    const tileIndex = regionEls.findIndex((el) => el.classList.contains("tile"));
    expect(regionIndex).toBeGreaterThanOrEqual(0);
    expect(regionIndex).toBeLessThan(tileIndex);
  });

  it("does not draw a region for a single ungrouped layer", () => {
    const units = [makeUnit({ id: "a" })];
    const { container } = render(<CanvasHost units={units} edges={[]} />);
    expect(container.querySelector(".region")).toBeNull();
  });

  it("clicking a tile selects its unit", () => {
    const units = [makeUnit({ id: "a" })];
    const { container } = render(<CanvasHost units={units} edges={[]} />);
    const tile = container.querySelector('.tile[data-id="a"]')!;
    fireEvent.click(tile);
    expect(useAppStore.getState().selection).toBe("a");
  });

  it("double-clicking a tile drills into it", () => {
    const units = [makeUnit({ id: "a" })];
    const { container } = render(<CanvasHost units={units} edges={[]} />);
    const tile = container.querySelector('.tile[data-id="a"]')!;
    fireEvent.doubleClick(tile);
    expect(useAppStore.getState().focus).toBe("a");
  });

  it("double-clicking a function-kind tile opens its flowchart instead of drilling", () => {
    const units = [makeUnit({ id: "fn1", kind: "function" })];
    const { container } = render(<CanvasHost units={units} edges={[]} />);
    const tile = container.querySelector('.tile[data-id="fn1"]')!;
    fireEvent.doubleClick(tile);
    const s = useAppStore.getState();
    expect(s.mode).toBe("flowchart");
    expect(s.flowchartFunctionId).toBe("fn1");
    expect(s.focus).toBeNull();
  });

  it("double-clicking empty canvas ascends", () => {
    useAppStore.getState().drill("u:x");
    const units = [makeUnit({ id: "a" })];
    render(<CanvasHost units={units} edges={[]} />);
    const scroll = screen.getByTestId("canvas-svg");
    fireEvent.doubleClick(scroll);
    expect(useAppStore.getState().focus).toBeNull();
  });

  it("hovering a tile keeps its touching edges at full opacity and dims edges that don't touch it", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" }), makeUnit({ id: "c" }), makeUnit({ id: "d" })];
    const edges: Edge[] = [
      { id: "e1", from: "a", to: "b", kind: "calls", weight: 1, source: "static", confidence: 1 },
      { id: "e2", from: "c", to: "d", kind: "calls", weight: 1, source: "static", confidence: 1 },
    ];
    const { container } = render(<CanvasHost units={units} edges={edges} />);
    fireEvent.mouseOver(container.querySelector('.tile[data-id="a"]')!);

    const paths = [...container.querySelectorAll("svg path")].filter((p) => (p.getAttribute("stroke") || "").startsWith("var(--connector"));
    expect(paths).toHaveLength(2);
    const touching = paths.find((p) => p.getAttribute("stroke") === "var(--connector-active)")!;
    const unrelated = paths.find((p) => p !== touching)!;
    expect(touching.getAttribute("opacity")).toBe("1");
    expect(unrelated.getAttribute("opacity")).toBe("var(--focus-dim-edge)");
  });

  it("hovering a tile dims unrelated nodes", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" }), makeUnit({ id: "unrelated" })];
    const edges: Edge[] = [{ id: "e1", from: "a", to: "b", kind: "calls", weight: 1, source: "static", confidence: 1 }];
    const { container } = render(<CanvasHost units={units} edges={edges} />);
    fireEvent.mouseOver(container.querySelector('.tile[data-id="a"]')!);

    const unrelatedTile = container.querySelector('.tile[data-id="unrelated"]') as HTMLElement;
    const hoveredTile = container.querySelector('.tile[data-id="a"]') as HTMLElement;
    // jsdom's CSSOM can't parse a var() into its numeric `opacity` property (it coerces to
    // "NaN"), unlike a real browser — so dimmed is asserted as "not opacity 1" here.
    expect(unrelatedTile.style.opacity).not.toBe("1");
    expect(hoveredTile.style.opacity).toBe("1");
  });

  it("does not re-create delta tile DOM nodes on hover", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    const deltaByUnit = new Map([["a", { status: "modified", amount: 0.5, risk: 0.2 }]]);
    const { container } = render(<CanvasHost units={units} edges={[]} deltaByUnit={deltaByUnit} />);

    const tileBefore = container.querySelector('.tile[data-id="a"]')!;
    fireEvent.mouseOver(container.querySelector('.tile[data-id="b"]')!);
    const tileAfter = container.querySelector('.tile[data-id="a"]')!;

    expect(tileAfter).toBe(tileBefore);
  });

  it("gives a modified tile a background whose alpha scales with delta amount", () => {
    const units = [makeUnit({ id: "a" })];
    const deltaByUnit = new Map([["a", { status: "modified", amount: 0.5, risk: 0.2 }]]);
    const { container } = render(<CanvasHost units={units} edges={[]} deltaByUnit={deltaByUnit} />);

    const tile = container.querySelector('.tile[data-id="a"]') as HTMLElement;
    expect(tile.style.background).toBe("rgba(242, 169, 59, 0.35)");
  });

  it("outlines an added tile and dashes an outline on a removed tile", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    const deltaByUnit = new Map([
      ["a", { status: "added", amount: 1, risk: null }],
      ["b", { status: "removed", amount: 1, risk: null }],
    ]);
    const { container } = render(<CanvasHost units={units} edges={[]} deltaByUnit={deltaByUnit} />);

    const added = container.querySelector('.tile[data-id="a"]') as HTMLElement;
    const removed = container.querySelector('.tile[data-id="b"]') as HTMLElement;
    expect(added.style.outline).toBe("2px solid var(--temp-2)");
    expect(removed.style.outline).toBe("1.6px dashed var(--temp-6)");
  });

  it("scene sits inside a native-scrolling container, so an oversized graph gets real scrollbars", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    const { container } = render(<CanvasHost units={units} edges={[]} />);
    const scroll = container.querySelector(".canvas-scroll")!;
    expect(scroll).not.toBeNull();
    expect(scroll).toBe(screen.getByTestId("canvas-svg"));
  });

  it("wheel zooms in: the container's rendered (CSS pixel) size grows on deltaY < 0", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    render(<CanvasHost units={units} edges={[]} />);
    const scroll = screen.getByTestId("canvas-svg") as HTMLElement;
    stubRect(scroll, 400, 300);
    const before = scroll.style.width;

    fireEvent.wheel(scroll, { deltaY: -100, clientX: 100, clientY: 100 });

    const after = scroll.style.width;
    expect(parseFloat(after)).toBeGreaterThan(parseFloat(before) || 0);
  });

  it("wheel zoom-out shrinks the container's rendered size, clamped to a min scale", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    render(<CanvasHost units={units} edges={[]} />);
    const scroll = screen.getByTestId("canvas-svg") as HTMLElement;
    stubRect(scroll, 400, 300);
    fireEvent.wheel(scroll, { deltaY: -100, clientX: 100, clientY: 100 });
    const before = parseFloat(scroll.style.width);

    for (let i = 0; i < 100; i++) {
      fireEvent.wheel(scroll, { deltaY: 100, clientX: 100, clientY: 100 });
    }
    const after = parseFloat(scroll.style.width);
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
  });

  it("dragging on empty canvas pans via native scroll instead of ascending", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    render(<CanvasHost units={units} edges={[]} />);
    const scroll = screen.getByTestId("canvas-svg") as HTMLDivElement;
    stubRect(scroll, 400, 300);
    scroll.scrollLeft = 50;
    scroll.scrollTop = 50;

    fireEvent.mouseDown(scroll, { clientX: 200, clientY: 200 });
    fireEvent.mouseMove(scroll, { clientX: 150, clientY: 180 });
    fireEvent.mouseUp(scroll, { clientX: 150, clientY: 180 });

    expect(scroll.scrollLeft).not.toBe(50);
    expect(scroll.scrollTop).not.toBe(50);
    expect(useAppStore.getState().focus).toBeNull();
  });

  it("only shows the scrollbar (via a 'panning' class) while a drag-pan is actually in progress", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    render(<CanvasHost units={units} edges={[]} />);
    const scroll = screen.getByTestId("canvas-svg") as HTMLDivElement;
    stubRect(scroll, 400, 300);

    expect(scroll.classList.contains("panning")).toBe(false);

    fireEvent.mouseDown(scroll, { clientX: 200, clientY: 200 });
    fireEvent.mouseMove(scroll, { clientX: 150, clientY: 180 });
    expect(scroll.classList.contains("panning")).toBe(true);

    fireEvent.mouseUp(scroll, { clientX: 150, clientY: 180 });
    expect(scroll.classList.contains("panning")).toBe(false);
  });

  it("double-clicking empty canvas still ascends after a drag/zoom sequence", () => {
    useAppStore.getState().drill("u:x");
    const units = [makeUnit({ id: "a" })];
    render(<CanvasHost units={units} edges={[]} />);
    const scroll = screen.getByTestId("canvas-svg");
    stubRect(scroll, 400, 300);
    fireEvent.wheel(scroll, { deltaY: -50, clientX: 50, clientY: 50 });
    fireEvent.doubleClick(scroll);
    expect(useAppStore.getState().focus).toBeNull();
  });

  it("mouse leave clears the hover highlight", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    const edges: Edge[] = [{ id: "e1", from: "a", to: "b", kind: "calls", weight: 1, source: "static", confidence: 1 }];
    const { container } = render(<CanvasHost units={units} edges={edges} />);
    const tileA = container.querySelector('.tile[data-id="a"]')!;
    fireEvent.mouseOver(tileA);
    expect((container.querySelector('.tile[data-id="b"]') as HTMLElement).style.opacity).toBe("1");

    fireEvent.mouseLeave(screen.getByTestId("canvas-svg"));

    expect((container.querySelector('.tile[data-id="a"]') as HTMLElement).style.opacity).toBe("1");
  });

  it("keeps a node's relative x order stable across a units/edges change (replay scrub), so nodes don't teleport (docs/serve.md#3)", () => {
    // "x" and "y" are children of "a" and "b" respectively. Rev 1 places x left of y. Rev 2
    // flips which parent owns which child in a way that would pull barycentre ordering to
    // put y left of x — seeding from the prior build's positions must keep x left of y
    // regardless, so the node doesn't visibly jump sides on a rev scrub.
    const leftEdge = (id: string, container: HTMLElement) => {
      const tile = container.querySelector(`.tile[data-id="${id}"]`) as HTMLElement;
      return parseFloat(tile.style.left);
    };

    const unitsRev1 = [makeUnit({ id: "root" }), makeUnit({ id: "a" }), makeUnit({ id: "b" }), makeUnit({ id: "x" }), makeUnit({ id: "y" })];
    const edgesRev1: Edge[] = [
      { id: "e0", from: "root", to: "a", kind: "calls", weight: 1, source: "static", confidence: 1 },
      { id: "e0b", from: "root", to: "b", kind: "calls", weight: 1, source: "static", confidence: 1 },
      { id: "e1", from: "a", to: "x", kind: "calls", weight: 1, source: "static", confidence: 1 },
      { id: "e2", from: "b", to: "y", kind: "calls", weight: 1, source: "static", confidence: 1 },
    ];
    const { container, rerender } = render(<CanvasHost units={unitsRev1} edges={edgesRev1} />);
    const xBefore = leftEdge("x", container);
    const yBefore = leftEdge("y", container);
    expect(xBefore).toBeLessThan(yBefore);

    const unitsRev2 = [makeUnit({ id: "root" }), makeUnit({ id: "a" }), makeUnit({ id: "b" }), makeUnit({ id: "y" }), makeUnit({ id: "x" })];
    const edgesRev2: Edge[] = [
      { id: "e0", from: "root", to: "a", kind: "calls", weight: 1, source: "static", confidence: 1 },
      { id: "e0b", from: "root", to: "b", kind: "calls", weight: 1, source: "static", confidence: 1 },
      { id: "e1", from: "a", to: "y", kind: "calls", weight: 1, source: "static", confidence: 1 },
      { id: "e2", from: "b", to: "x", kind: "calls", weight: 1, source: "static", confidence: 1 },
    ];
    rerender(<CanvasHost units={unitsRev2} edges={edgesRev2} />);

    const xAfter = leftEdge("x", container);
    const yAfter = leftEdge("y", container);
    expect(xAfter).toBeLessThan(yAfter);
  });
});

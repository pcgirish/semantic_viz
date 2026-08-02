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

  it("double-clicking empty canvas ascends", () => {
    useAppStore.getState().drill("u:x");
    const units = [makeUnit({ id: "a" })];
    render(<CanvasHost units={units} edges={[]} />);
    const svg = screen.getByTestId("canvas-svg");
    fireEvent.doubleClick(svg);
    expect(useAppStore.getState().focus).toBeNull();
  });

  it("hovering a tile marks its outgoing edges depends-on and incoming edges used-by, with different classes", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" }), makeUnit({ id: "c" })];
    const edges: Edge[] = [
      { id: "e1", from: "a", to: "b", kind: "calls", weight: 1, source: "static", confidence: 1 },
      { id: "e2", from: "c", to: "a", kind: "calls", weight: 1, source: "static", confidence: 1 },
    ];
    const { container } = render(<CanvasHost units={units} edges={edges} />);
    fireEvent.mouseEnter(container.querySelector('.tile[data-id="a"]')!);

    const depLink = container.querySelector('.lk[data-from="a"][data-to="b"]')!;
    const userLink = container.querySelector('.lk[data-from="c"][data-to="a"]')!;
    expect(depLink.classList.contains("depends-on")).toBe(true);
    expect(userLink.classList.contains("used-by")).toBe(true);
    expect(depLink.classList.contains("used-by")).toBe(false);
  });

  it("hovering a tile dims unrelated nodes and links", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" }), makeUnit({ id: "unrelated" })];
    const edges: Edge[] = [{ id: "e1", from: "a", to: "b", kind: "calls", weight: 1, source: "static", confidence: 1 }];
    const { container } = render(<CanvasHost units={units} edges={edges} />);
    fireEvent.mouseEnter(container.querySelector('.tile[data-id="a"]')!);

    const unrelatedTile = container.querySelector('.tile[data-id="unrelated"]')!;
    const hoveredTile = container.querySelector('.tile[data-id="a"]')!;
    expect(unrelatedTile.classList.contains("dim")).toBe(true);
    expect(hoveredTile.classList.contains("dim")).toBe(false);
  });

  it("does not re-create delta tile nodes on hover, so the pulse animation doesn't replay every time the mouse moves over a tile", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    const deltaByUnit = new Map([["a", { status: "modified", amount: 0.5, risk: 0.2 }]]);
    const { container } = render(<CanvasHost units={units} edges={[]} deltaByUnit={deltaByUnit} />);

    const tileBefore = container.querySelector('.tile[data-id="a"]')!;
    fireEvent.mouseEnter(container.querySelector('.tile[data-id="b"]')!);
    const tileAfter = container.querySelector('.tile[data-id="a"]')!;

    expect(tileAfter).toBe(tileBefore);
  });

  it("sets a viewBox fitted to the scene's bounds so nodes off the origin are visible", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    const edges: Edge[] = [{ id: "e1", from: "a", to: "b", kind: "calls", weight: 1, source: "static", confidence: 1 }];
    render(<CanvasHost units={units} edges={edges} />);
    const svg = screen.getByTestId("canvas-svg");
    const viewBox = svg.getAttribute("viewBox");
    expect(viewBox).not.toBeNull();
    const [, , w, h] = viewBox!.split(" ").map(Number);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
  });

  it("scene sits inside a native-scrolling container, so an oversized graph gets real scrollbars", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    const { container } = render(<CanvasHost units={units} edges={[]} />);
    const scroll = container.querySelector(".canvas-scroll")!;
    expect(scroll).not.toBeNull();
    expect(scroll.contains(screen.getByTestId("canvas-svg"))).toBe(true);
  });

  it("wheel zooms in: the SVG's rendered (CSS pixel) size grows on deltaY < 0", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    const { container } = render(<CanvasHost units={units} edges={[]} />);
    const scroll = container.querySelector(".canvas-scroll")!;
    stubRect(scroll, 400, 300);
    const svg = screen.getByTestId("canvas-svg");
    const before = Number(svg.getAttribute("width"));

    fireEvent.wheel(scroll, { deltaY: -100, clientX: 100, clientY: 100 });

    const after = Number(svg.getAttribute("width"));
    expect(after).toBeGreaterThan(before);
  });

  it("wheel zoom-out shrinks the SVG's rendered size, clamped to a min scale", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    const { container } = render(<CanvasHost units={units} edges={[]} />);
    const scroll = container.querySelector(".canvas-scroll")!;
    stubRect(scroll, 400, 300);
    const svg = screen.getByTestId("canvas-svg");
    const before = Number(svg.getAttribute("width"));

    for (let i = 0; i < 100; i++) {
      fireEvent.wheel(scroll, { deltaY: 100, clientX: 100, clientY: 100 });
    }
    const after = Number(svg.getAttribute("width"));
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
  });

  it("dragging on empty canvas pans via native scroll instead of ascending", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    const { container } = render(<CanvasHost units={units} edges={[]} />);
    const scroll = container.querySelector(".canvas-scroll")! as HTMLDivElement;
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
    const { container } = render(<CanvasHost units={units} edges={[]} />);
    const scroll = container.querySelector(".canvas-scroll")! as HTMLDivElement;
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
    const { container } = render(<CanvasHost units={units} edges={[]} />);
    const scroll = container.querySelector(".canvas-scroll")!;
    stubRect(scroll, 400, 300);
    const svg = screen.getByTestId("canvas-svg");
    fireEvent.wheel(scroll, { deltaY: -50, clientX: 50, clientY: 50 });
    fireEvent.doubleClick(svg);
    expect(useAppStore.getState().focus).toBeNull();
  });

  it("mouse leave clears the hover highlight", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    const edges: Edge[] = [{ id: "e1", from: "a", to: "b", kind: "calls", weight: 1, source: "static", confidence: 1 }];
    const { container } = render(<CanvasHost units={units} edges={edges} />);
    const tileA = container.querySelector('.tile[data-id="a"]')!;
    fireEvent.mouseEnter(tileA);
    fireEvent.mouseLeave(tileA);

    expect(container.querySelector('.tile[data-id="b"]')!.classList.contains("dim")).toBe(false);
  });

  it("applies a pulse class to tiles with a delta, so scrubbing rev-to-rev is visibly animated", () => {
    const units = [makeUnit({ id: "a" })];
    const deltaByUnit = new Map([["a", { status: "modified", amount: 0.5, risk: 0.2 }]]);
    const { container } = render(<CanvasHost units={units} edges={[]} deltaByUnit={deltaByUnit} />);

    expect(container.querySelector('.tile[data-id="a"]')!.classList.contains("pulse")).toBe(true);
  });

  it("does not re-create delta tile nodes on hover, so the pulse animation doesn't replay every time the mouse moves over a tile", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    const deltaByUnit = new Map([["a", { status: "modified", amount: 0.5, risk: 0.2 }]]);
    const { container } = render(<CanvasHost units={units} edges={[]} deltaByUnit={deltaByUnit} />);

    const tileBefore = container.querySelector('.tile[data-id="a"]')!;
    fireEvent.mouseEnter(container.querySelector('.tile[data-id="b"]')!);
    const tileAfter = container.querySelector('.tile[data-id="a"]')!;

    expect(tileAfter).toBe(tileBefore);
  });
});

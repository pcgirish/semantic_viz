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

  it("wheel zooms: viewBox shrinks on zoom-in (deltaY < 0)", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    render(<CanvasHost units={units} edges={[]} />);
    const svg = screen.getByTestId("canvas-svg");
    const before = svg.getAttribute("viewBox")!.split(" ").map(Number);

    fireEvent.wheel(svg, { deltaY: -100, clientX: 100, clientY: 100 });

    const after = svg.getAttribute("viewBox")!.split(" ").map(Number);
    expect(after[2]).toBeLessThan(before[2]);
    expect(after[3]).toBeLessThan(before[3]);
  });

  it("wheel zoom-out grows the viewBox, clamped to a max scale", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    render(<CanvasHost units={units} edges={[]} />);
    const svg = screen.getByTestId("canvas-svg");
    const before = svg.getAttribute("viewBox")!.split(" ").map(Number);

    for (let i = 0; i < 100; i++) {
      fireEvent.wheel(svg, { deltaY: 100, clientX: 100, clientY: 100 });
    }
    const after = svg.getAttribute("viewBox")!.split(" ").map(Number);
    expect(after[2]).toBeGreaterThan(before[2]);
    expect(Number.isFinite(after[2])).toBe(true);
  });

  it("dragging on empty canvas pans the viewBox instead of ascending", () => {
    const units = [makeUnit({ id: "a" }), makeUnit({ id: "b" })];
    render(<CanvasHost units={units} edges={[]} />);
    const svg = screen.getByTestId("canvas-svg");
    svg.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, toJSON() {} }) as DOMRect;
    const before = svg.getAttribute("viewBox")!.split(" ").map(Number);

    fireEvent.mouseDown(svg, { clientX: 200, clientY: 200 });
    fireEvent.mouseMove(svg, { clientX: 150, clientY: 180 });
    fireEvent.mouseUp(svg, { clientX: 150, clientY: 180 });

    const after = svg.getAttribute("viewBox")!.split(" ").map(Number);
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(useAppStore.getState().focus).toBeNull();
  });

  it("double-clicking empty canvas still ascends after a drag/zoom sequence", () => {
    useAppStore.getState().drill("u:x");
    const units = [makeUnit({ id: "a" })];
    render(<CanvasHost units={units} edges={[]} />);
    const svg = screen.getByTestId("canvas-svg");
    fireEvent.wheel(svg, { deltaY: -50, clientX: 50, clientY: 50 });
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
});

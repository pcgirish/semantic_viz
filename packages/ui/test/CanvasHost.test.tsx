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
});

import { describe, expect, it } from "vitest";
import { node } from "../src/node.js";
import type { SceneNode } from "@scv/layout";

function makeNode(overrides: Partial<SceneNode> & { id: string }): SceneNode {
  return { x: 0, y: 0, w: 100, h: 60, depth: 0, sides: 3, heat: 0, ring: false, ...overrides };
}

describe("node", () => {
  it("renders an SVG group at the node's position", () => {
    const el = node(makeNode({ id: "a" }));
    expect(el.tagName.toLowerCase()).toBe("g");
    expect(el.dataset.id).toBe("a");
  });

  it("draws a triangle for the trivial complexity bucket (sides=3)", () => {
    const el = node(makeNode({ id: "a", sides: 3 }));
    const polygon = el.querySelector(".complexity-glyph")!;
    const points = polygon.getAttribute("points")!.trim().split(/\s+/);
    expect(points).toHaveLength(3);
  });

  it("draws a square for the ordinary complexity bucket (sides=4)", () => {
    const el = node(makeNode({ id: "a", sides: 4 }));
    const points = el.querySelector(".complexity-glyph")!.getAttribute("points")!.trim().split(/\s+/);
    expect(points).toHaveLength(4);
  });

  it("draws a hexagon for the involved complexity bucket (sides=6)", () => {
    const el = node(makeNode({ id: "a", sides: 6 }));
    const points = el.querySelector(".complexity-glyph")!.getAttribute("points")!.trim().split(/\s+/);
    expect(points).toHaveLength(6);
  });

  it("draws a circle, not a polygon, for the alarming bucket (sides=0)", () => {
    const el = node(makeNode({ id: "a", sides: 0 }));
    expect(el.querySelector("circle.complexity-glyph")).not.toBeNull();
    expect(el.querySelector("polygon.complexity-glyph")).toBeNull();
  });

  it("draws an offset ring when ring is true (risk >= 0.5), not present otherwise", () => {
    const withRing = node(makeNode({ id: "a", ring: true }));
    const withoutRing = node(makeNode({ id: "b", ring: false }));
    expect(withRing.querySelector(".ring")).not.toBeNull();
    expect(withoutRing.querySelector(".ring")).toBeNull();
  });
});

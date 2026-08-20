import { describe, expect, it } from "vitest";
import { node } from "../src/node.js";
import type { SceneNode } from "@scv/layout";
import { GLYPH_TRACK, measureLabel } from "../src/node.js";

function makeNode(overrides: Partial<SceneNode> & { id: string }): SceneNode {
  return {
    x: 0,
    y: 0,
    w: 100,
    h: 60,
    depth: 0,
    sides: 3,
    heat: 0,
    ring: false,
    name: overrides.id,
    sloc: 10,
    fanIn: 0,
    fanOut: 0,
    layer: "",
    group: "",
    complexity: 0,
    ...overrides,
  };
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

  it("renders the raw complexity number next to the glyph when complexity is set", () => {
    const el = node(makeNode({ id: "a", complexity: 5 }));
    const label = el.querySelector(".cx");
    expect(label).not.toBeNull();
    expect(label!.textContent).toBe("5");
  });

  it("omits the complexity label when complexity is 0", () => {
    const el = node(makeNode({ id: "a", complexity: 0 }));
    expect(el.querySelector(".cx")).toBeNull();
  });

  it("draws an offset ring when ring is true (risk >= 0.5), not present otherwise", () => {
    const withRing = node(makeNode({ id: "a", ring: true }));
    const withoutRing = node(makeNode({ id: "b", ring: false }));
    expect(withRing.querySelector(".ring")).not.toBeNull();
    expect(withoutRing.querySelector(".ring")).toBeNull();
  });

  it("renders the unit's name as a label", () => {
    const el = node(makeNode({ id: "a", name: "computeTotal" }));
    const label = el.querySelector(".nm")!;
    expect(label.textContent).toBe("computeTotal");
  });

  it("renders a metadata line with sloc, fan-in, and fan-out", () => {
    const el = node(makeNode({ id: "a", sloc: 42, fanIn: 3, fanOut: 5, w: 200 }));
    const meta = el.querySelector(".mt")!;
    expect(meta.textContent).toContain("42");
    expect(meta.textContent).toContain("3");
    expect(meta.textContent).toContain("5");
  });

  it("truncates a name too long for a narrow tile instead of overflowing into neighbours", () => {
    const el = node(makeNode({ id: "a", name: "GET /public/orders/checkout", w: 96 }));
    const label = el.querySelector(".nm")!;
    expect(label.textContent!.length).toBeLessThan("GET /public/orders/checkout".length);
    expect(label.textContent!.endsWith("…")).toBe(true);
  });

  it("does not truncate a name that already fits the tile", () => {
    const el = node(makeNode({ id: "a", name: "ok", w: 200 }));
    const label = el.querySelector(".nm")!;
    expect(label.textContent).toBe("ok");
  });

  it("puts the full name in a <title> so a truncated label is still readable on hover", () => {
    const el = node(makeNode({ id: "a", name: "GET /public/orders/checkout", w: 96 }));
    expect(el.querySelector("title")?.textContent).toBe("GET /public/orders/checkout");
  });

  it("keeps a name that fits the real rendered width, rather than over-truncating on a pessimistic estimate", () => {
    // "fastapi 0.115" at nameSize 14 on a 220px tile measures ~85px in Space Grotesk; the
    // tile has ~175px of label track once padding and the glyph are budgeted, so nothing
    // should be dropped. The old 0.55 em/char estimate cut it to "fastapi 0…".
    const el = node(makeNode({ id: "a", name: "fastapi 0.115", w: 220 }));
    expect(el.querySelector(".nm")!.textContent).toBe("fastapi 0.115");
  });

  it("reserves the complexity glyph's track so a long name cannot run underneath it", () => {
    const name = "averyLongUnitNameThatKeepsGoing";
    const wide = node(makeNode({ id: "a", name, w: 260 }));
    const fitted = wide.querySelector(".nm")!.textContent!;
    // The glyph occupies the tile's top-right corner; the label must stop before it.
    const nameSize = Math.min(14, Math.max(10.5, 260 / 10));
    expect(measureLabel(fitted, nameSize)).toBeLessThanOrEqual(260 - 12 - GLYPH_TRACK);
  });

  it("gives a diamond block its full inner width, since it carries no complexity glyph", () => {
    const name = "requestIsFullyAuthenticatedAndAuthorized";
    const diamond = node(makeNode({ id: "d", blockType: "decision", name, w: 140 }));
    const tile = node(makeNode({ id: "a", name, w: 140 }));
    const diamondLen = diamond.querySelector(".nm")!.textContent!.length;
    const tileLen = tile.querySelector(".nm")!.textContent!.length;
    expect(diamondLen).toBeGreaterThan(tileLen);
  });

  it("truncates the metadata line too, so 'sloc · in · out' doesn't overflow a narrow tile", () => {
    const el = node(makeNode({ id: "a", sloc: 800, fanIn: 30, fanOut: 40, w: 96 }));
    const meta = el.querySelector(".mt")!;
    expect(meta.textContent!.length).toBeLessThan(`${800} sloc · in ${30} · out ${40}`.length);
  });

  it("renders a decision block as a diamond polygon with its condition centered inside", () => {
    const el = node(makeNode({ id: "d", blockType: "decision", condition: "x > 0", name: "x > 0" }));
    const diamond = el.querySelector(".block-diamond")!;
    expect(diamond).toBeTruthy();
    const points = diamond.getAttribute("points")!.trim().split(/\s+/);
    expect(points).toHaveLength(4);
    const label = el.querySelector(".nm")!;
    expect(label.textContent).toBe("x > 0");
  });

  it("renders a loop block as a diamond polygon too", () => {
    const el = node(makeNode({ id: "l", blockType: "loop", condition: "x", name: "x" }));
    expect(el.querySelector(".block-diamond")).toBeTruthy();
  });

  it("does not render a diamond for a non-decision/loop block", () => {
    const el = node(makeNode({ id: "s", blockType: "sequential" }));
    expect(el.querySelector(".block-diamond")).toBeNull();
  });

  it("does not render a diamond for a regular (non-flowchart) node", () => {
    const el = node(makeNode({ id: "a" }));
    expect(el.querySelector(".block-diamond")).toBeNull();
  });

  it("does not render the complexity glyph or sloc/fan-in/out meta line for any flowchart block", () => {
    const el = node(makeNode({ id: "s", blockType: "sequential" }));
    expect(el.querySelector(".complexity-glyph")).toBeNull();
    expect(el.querySelector(".mt")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import type { SceneNode } from "@scv/layout";
import { node } from "../src/node.js";
import { codedreamLayerPalette, hashLayerToColor } from "../src/theme.js";

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
    groupId: "",
    complexity: 0,
    ...overrides,
  };
}

/** The rendered tile's outermost element — what CanvasHost places on the canvas. */
function tile(element: ReactElement): HTMLElement {
  const { container } = render(element);
  const el = container.querySelector(".tile");
  if (!el) throw new Error("no .tile rendered");
  return el as HTMLElement;
}

describe("node (React tile)", () => {
  it("keeps the structural hooks the canvas host and its tests key on", () => {
    const el = tile(node(makeNode({ id: "u:a" })));
    expect(el.className).toContain("tile");
    expect(el.dataset.id).toBe("u:a");
  });

  it("positions the tile at the node's box, relative to the given origin", () => {
    const el = tile(node(makeNode({ id: "a", x: 140, y: 200, h: 72 }), { origin: { x: 40, y: 50 } }));
    expect(el.style.position).toBe("absolute");
    expect(el.style.left).toBe("100px");
    expect(el.style.top).toBe("150px");
    expect(el.style.height).toBe("72px");
  });

  it("renders the unit's name as the label", () => {
    const el = tile(node(makeNode({ id: "a", name: "parser" })));
    expect(el.textContent).toContain("parser");
  });
});

// docs/serve.md#2 — the encoding channels. These exist only in styling, so nothing
// guarded them before the skin owned the tile.
describe("node encoding channels", () => {
  describe("sides = complexity, as tile shape", () => {
    const cases: Array<[SceneNode["sides"], string]> = [
      [3, "square"],
      [4, "chamfer"],
      [6, "hex"],
      [0, "hex-tall"],
    ];
    it.each(cases)("sides=%s renders shape %s", (sides, shape) => {
      const el = tile(node(makeNode({ id: "a", sides })));
      expect(el.dataset.shape).toBe(shape);
    });

    it("renders a decision block as a diamond regardless of sides", () => {
      const el = tile(node(makeNode({ id: "a", sides: 6, blockType: "decision" })));
      expect(el.dataset.shape).toBe("diamond");
    });

    it("renders a loop block as a diamond too", () => {
      const el = tile(node(makeNode({ id: "a", sides: 4, blockType: "loop" })));
      expect(el.dataset.shape).toBe("diamond");
    });

    it("leaves a non-decision block on its complexity shape", () => {
      const el = tile(node(makeNode({ id: "a", sides: 6, blockType: "sequential" })));
      expect(el.dataset.shape).toBe("hex");
    });
  });

  describe("hue = layer", () => {
    it("colors the tile by hashing the layer id, and is stable for that layer", () => {
      const expected = hashLayerToColor("l:domain", codedreamLayerPalette);
      const a = tile(node(makeNode({ id: "a", layer: "l:domain" }), { layerColor: expected }));
      const b = tile(node(makeNode({ id: "b", layer: "l:domain" }), { layerColor: expected }));
      expect(a.dataset.color).toBe(expected);
      expect(b.dataset.color).toBe(a.dataset.color);
    });

    it("gives different layers different hues", () => {
      const one = hashLayerToColor("l:domain", codedreamLayerPalette);
      const two = hashLayerToColor("l:infra", codedreamLayerPalette);
      expect(one).not.toBe(two);
    });
  });

  describe("delta: fill saturation = amount, outline = status", () => {
    it("outlines an added unit", () => {
      const el = tile(node(makeNode({ id: "a" }), { delta: { status: "added", amount: 1, risk: null } }));
      expect(el.style.outline).toContain("var(--temp-2)");
      expect(el.style.outline).toContain("solid");
    });

    it("outlines a removed unit with a dashed rule, distinct from added", () => {
      const el = tile(node(makeNode({ id: "a" }), { delta: { status: "removed", amount: 1, risk: null } }));
      expect(el.style.outline).toContain("dashed");
      expect(el.style.outline).toContain("var(--temp-6)");
    });

    it.each(["modified", "risk_changed", "rollup"])("fills a %s unit, with alpha tracking amount", (status) => {
      const light = tile(node(makeNode({ id: "a" }), { delta: { status, amount: 0.2, risk: null } }));
      const heavy = tile(node(makeNode({ id: "b" }), { delta: { status, amount: 0.9, risk: null } }));
      const alphaOf = (s: string) => Number(s.match(/rgba\([^)]*,\s*([\d.]+)\)/)?.[1] ?? NaN);
      expect(alphaOf(heavy.style.background)).toBeGreaterThan(alphaOf(light.style.background));
    });

    it("leaves a tile unstyled outside delta mode", () => {
      const el = tile(node(makeNode({ id: "a" })));
      expect(el.style.outline).toBe("");
      expect(el.style.background).toBe("");
    });
  });

  describe("risk", () => {
    it("marks a unit at risk >= 0.5, and not below it", () => {
      const at = tile(node(makeNode({ id: "a" }), { delta: { status: "modified", amount: 0.1, risk: 0.5 } }));
      const below = tile(node(makeNode({ id: "b" }), { delta: { status: "modified", amount: 0.1, risk: 0.49 } }));
      expect(at.style.filter).toContain("var(--temp-6)");
      expect(below.style.filter).toBe("");
    });

    it("does not mark a unit whose risk is unknown", () => {
      const el = tile(node(makeNode({ id: "a" }), { delta: { status: "modified", amount: 0.1, risk: null } }));
      expect(el.style.filter).toBe("");
    });
  });

  describe("coupling: face colour = direction of a hovered sibling's edges", () => {
    /**
     * The face, not the element behind it. PolyNode lays an absolutely positioned Facet SVG
     * over the tile (inset:0) and that path carries its own fill, so asserting the wrapper's
     * background can pass while the visible polygon shows nothing of the coupling.
     */
    function face(el: HTMLElement): { fill: string; stops: string[] } {
      const path = el.querySelector("svg path") as SVGPathElement;
      const fill = path.getAttribute("fill") ?? "";
      const id = /^url\(#(.+)\)$/.exec(fill)?.[1];
      const stops = id
        ? [...el.querySelectorAll(`#${id} stop`)].map((s) => s.getAttribute("stop-color") ?? "")
        : [];
      return { fill, stops };
    }

    function render1(ctx: Parameters<typeof node>[1]): HTMLElement {
      const { container } = render(node(makeNode({ id: "a" }), ctx));
      return container.querySelector(".tile") as HTMLElement;
    }

    it("paints a tile coupled only outbound in the outbound colour, over the layer hue", () => {
      const { fill, stops } = face(render1({ coupling: "out", layerColor: "#123456" }));
      const painted = [fill, ...stops].join(" ");
      expect(painted).toContain("var(--temp-4)");
      expect(painted).not.toContain("var(--cool-azure)");
      // Solid rather than an alpha wash, so the layer hue underneath does not dilute it.
      expect(painted).not.toContain("#123456");
    });

    it("paints a tile coupled only inbound in the inbound colour", () => {
      const painted = Object.values(face(render1({ coupling: "in" }))).flat().join(" ");
      expect(painted).toContain("var(--cool-azure)");
      expect(painted).not.toContain("var(--temp-4)");
    });

    it("splits a both-ways tile across the face, one direction per gradient stop", () => {
      // The point of the split is that "both" is visibly composed of in and out rather than
      // being a third thing to learn, so both colours must appear on the polygon itself.
      const { fill, stops } = face(render1({ coupling: "both" }));
      expect(fill).toMatch(/^url\(#/);
      expect(stops).toContain("var(--temp-4)");
      expect(stops).toContain("var(--cool-azure)");
    });

    it("leaves an uncoupled tile's face to the layer hue", () => {
      const painted = Object.values(face(render1({ layerColor: "#123456" }))).flat().join(" ");
      expect(painted).toContain("#123456");
      expect(painted).not.toContain("var(--temp-4)");
      expect(painted).not.toContain("var(--cool-azure)");
    });
  });
});

import { describe, expect, it } from "vitest";
import type { Scene } from "@scv/layout";
import { minimapProjection, type Viewer } from "../src/minimap.js";

function scene(): Scene {
  return {
    // Two rank rows: `lo` at the top of the ground plane (z small), `hi` below it. In the
    // 2D view this is the axis the whole layout is built on — rank increases downward.
    nodes: [
      { id: "lo", x: 0, y: 0, w: 96, h: 96, depth: 100, layer: "api" },
      { id: "hi", x: 0, y: 400, w: 96, h: 96, depth: 100, layer: "db" },
    ],
    links: [],
    regions: [],
  } as unknown as Scene;
}

const viewer = (over: Partial<Viewer> = {}): Viewer => ({ x: 48, z: 48, heading: 0, ...over });

describe("minimapProjection", () => {
  it("maps world x/z to map coordinates, so the map is the 2D view seen from above", () => {
    // The minimap is not a new picture of the codebase — it is the same top-down layout the
    // 2D skin draws. Anything else would give the user two different mental models to
    // reconcile while they are already lost (docs/serve.md#189).
    const p = minimapProjection(scene(), { width: 200, height: 200 }, viewer());
    const lo = p.nodes.find((n) => n.id === "lo")!;
    const hi = p.nodes.find((n) => n.id === "hi")!;
    // Rank increases with world z, and must still increase down the map.
    expect(hi.y).toBeGreaterThan(lo.y);
    expect(lo.x).toBeCloseTo(hi.x);
  });

  it("fits the whole city inside the map, whatever the scene's aspect ratio", () => {
    // A minimap that crops is worse than none: the part it cuts off is exactly the part you
    // cannot see from street level either, so cropping hides the same information twice.
    const p = minimapProjection(scene(), { width: 200, height: 200 }, viewer());
    for (const n of p.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(200);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(200);
    }
  });

  it("places the viewer on the map, because a map without a you-are-here answers nothing", () => {
    // This is the entire reason the minimap is load-bearing rather than decorative. Rank is
    // invisible at eye level (Checkpoint 2, question 2); the map can only restore it if it
    // shows where the walker is standing within it.
    const p = minimapProjection(scene(), { width: 200, height: 200 }, viewer({ x: 48, z: 48 }));
    const lo = p.nodes.find((n) => n.id === "lo")!;
    expect(p.viewer.x).toBeCloseTo(lo.x);
    expect(p.viewer.y).toBeCloseTo(lo.y);
  });

  it("shows which way the walker is facing, not just where they stand", () => {
    // Position alone still leaves "which way is up the dependency graph?" unanswered: you
    // know where you are on the map but not which direction on it you are pointed, so you
    // cannot tell whether walking forward takes you up-rank or down.
    const north = minimapProjection(scene(), { width: 200, height: 200 }, viewer({ heading: 0 }));
    const south = minimapProjection(scene(), { width: 200, height: 200 }, viewer({ heading: Math.PI }));
    expect(north.viewer.heading).not.toBeCloseTo(south.viewer.heading);
  });

  it("keeps layer hue on the map, so districts are recognisable from it", () => {
    // Hue massing is the one wayfinding channel Checkpoint 2 found already working. Carrying
    // it onto the map is what lets the user match what they see ahead of them to what the
    // map shows, instead of treating the two views as unrelated.
    const p = minimapProjection(scene(), { width: 200, height: 200 }, viewer());
    expect(p.nodes.find((n) => n.id === "lo")!.layer).toBe("api");
    expect(p.nodes.find((n) => n.id === "hi")!.layer).toBe("db");
  });

  it("fits a city whose origin is not zero, rather than sliding it off the map", () => {
    // The layout engine does not guarantee a scene starts at the origin — a drilled level
    // inherits its parent's coordinates. Scaling world positions without first subtracting
    // the scene's own minimum pushes the whole city off the map by however far from zero it
    // happens to begin, and the map goes blank exactly when it is being relied on.
    const offset = {
      nodes: [
        { id: "lo", x: 5000, y: 5000, w: 96, h: 96, depth: 100, layer: "api" },
        { id: "hi", x: 5000, y: 5400, w: 96, h: 96, depth: 100, layer: "db" },
      ],
      links: [],
      regions: [],
    } as unknown as Scene;
    const p = minimapProjection(offset, { width: 200, height: 200 }, viewer({ x: 5048, z: 5048 }));
    for (const n of p.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(200);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(200);
    }
    expect(p.viewer.x).toBeGreaterThanOrEqual(0);
    expect(p.viewer.x).toBeLessThanOrEqual(200);
  });

  it("handles an empty scene without producing NaN coordinates", () => {
    const empty = { nodes: [], links: [], regions: [] } as unknown as Scene;
    const p = minimapProjection(empty, { width: 200, height: 200 }, viewer());
    expect(Number.isFinite(p.viewer.x)).toBe(true);
    expect(Number.isFinite(p.viewer.y)).toBe(true);
  });
});

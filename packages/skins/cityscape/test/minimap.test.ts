import { describe, expect, it } from "vitest";
import type { Scene } from "@semviz/layout";
import { minimapProjection, type Viewer } from "../src/minimap.js";
import { bounds } from "../src/bounds.js";

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

  it("carries risk onto the map, so a beacon is findable when geometry hides it", () => {
    // The beacon answers "the thing you most need to see cannot hide behind a taller
    // neighbour" in the 3D view, but from inside a dense block it can still be out of frame
    // entirely. The map is the vantage that cannot be occluded, so risk has to reach it.
    const s = scene();
    (s.nodes[1] as { ring: boolean }).ring = true;
    const p = minimapProjection(s, { width: 200, height: 200 }, viewer());

    expect(p.nodes.find((n) => n.id === "hi")!.risk).toBe(true);
    expect(p.nodes.find((n) => n.id === "lo")!.risk).toBe(false);
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

describe("minimapProjection — the viewer is always on the map", () => {
  // Found in the browser, not in a test: the street camera stands *outside* the city by a
  // standoff computed from the city's own width, so a map scaled to the city's bounds alone
  // puts the marker hundreds of pixels below its own box, clipped and invisible. The map lost
  // the walker at exactly the moment the walk began.
  //
  // A map that can drop its "you are here" marker is not a map. So the extent it scales to is
  // the city *and* the viewer, always.
  const size = { width: 168, height: 168 };

  const inside = (p: { x: number; y: number }) =>
    p.x >= 0 && p.x <= size.width && p.y >= 0 && p.y <= size.height;

  it("keeps the marker in the box when the walker stands well outside the city", () => {
    const city = scene();
    const p = minimapProjection(city, size, { x: 150, z: 4000, heading: 0 });
    expect(inside(p.viewer)).toBe(true);
  });

  it("keeps the marker in the box from any direction, including behind the origin", () => {
    const city = scene();
    for (const viewer of [
      { x: -3000, z: 0, heading: 0 },
      { x: 0, z: -3000, heading: 0 },
      { x: 5000, z: 5000, heading: 0 },
    ]) {
      expect(inside(minimapProjection(city, size, viewer).viewer)).toBe(true);
    }
  });

  it("keeps every building on the map too, rather than pushing the city off to fit the walker", () => {
    const city = scene();
    const p = minimapProjection(city, size, { x: 150, z: 4000, heading: 0 });
    for (const n of p.nodes) expect(inside(n)).toBe(true);
  });

  it("still fills the box with the city when the walker is standing in it", () => {
    // The zoom-out must be paid for only when it is needed: a walker inside the city gets the
    // same close-in map they had before, not one shrunk to make room for nothing.
    const city = scene();
    const b = bounds(city);
    const close = minimapProjection(city, size, { x: b.cx, z: b.cz, heading: 0 });
    const far = minimapProjection(city, size, { x: b.cx, z: 4000, heading: 0 });
    expect(close.scale).toBeGreaterThan(far.scale);
  });
});

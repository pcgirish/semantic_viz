import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { Scene } from "@semviz/layout";
import { ground } from "../src/ground.js";

function scene(nodes?: Array<Record<string, unknown>>): Scene {
  return {
    nodes: nodes ?? [
      { id: "a", x: 0, y: 0, w: 96, h: 96, depth: 100 },
      { id: "b", x: 300, y: 0, w: 96, h: 96, depth: 100 },
    ],
    links: [],
    regions: [],
  } as unknown as Scene;
}

describe("ground", () => {
  it("gives the walker a floor, so the city sits on something rather than floating in void", () => {
    // At orbit height the absence of a ground plane is invisible — you are looking down at
    // rooftops. At eye level it is the first thing you notice: buildings hang in black with
    // no surface joining them, and there is no sense of standing anywhere.
    const g = ground(scene());
    const plane = g.getObjectByName("ground") as THREE.Mesh;
    expect(plane).toBeTruthy();
    // Lying flat under the city, not standing up like a wall.
    expect(plane.rotation.x).toBeCloseTo(-Math.PI / 2);
    expect(plane.position.y).toBeLessThanOrEqual(0);
  });

  it("extends well beyond the city, so the floor never ends inside the view", () => {
    // A plane sized to the footprint has a visible edge a few steps outside the outermost
    // building, and walking to it shows the void underneath. It has to run past the fog
    // distance instead, so the floor fades out rather than stopping.
    const s = scene();
    const g = ground(s);
    const plane = g.getObjectByName("ground") as THREE.Mesh;
    const geometry = plane.geometry as THREE.PlaneGeometry;
    // The scene spans x 0..396, which is the longer of its two extents.
    expect(geometry.parameters.width).toBeGreaterThan(396 * 2);
  });

  it("draws a grid on the floor, matching the 2D canvas's own grid", () => {
    // The grid is what makes movement legible: on a featureless plane, walking forward
    // looks identical to standing still. It also ties the 3D floor to the 2D canvas, which
    // uses the same --grid-cell token (design-system/tokens/geometry-3d.css).
    const g = ground(scene());
    expect(g.getObjectByName("grid")).toBeTruthy();
  });

  it("scales the grid to the city, so a large scene is not drawn with millions of lines", () => {
    // Grid cells are a fixed world size, so the line count grows with the square of the
    // scene's extent. A grid helper built naively on a big repo allocates a buffer large
    // enough to stall the first frame.
    const big = ground(scene([{ id: "a", x: 0, y: 0, w: 40000, h: 40000, depth: 100 }]));
    const grid = big.getObjectByName("grid") as THREE.GridHelper;
    const positions = (grid.geometry as THREE.BufferGeometry).getAttribute("position");
    expect(positions.count).toBeLessThan(20000);
  });
});

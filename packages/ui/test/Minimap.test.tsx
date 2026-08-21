import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { Scene } from "@scv/layout";
import type { Viewer } from "@scv/skin-cityscape";
import { Minimap } from "../src/Minimap.js";

afterEach(() => {
  cleanup();
});

/**
 * The wedge must point the way the camera faces. Asserting the transform string against the
 * implementation's own formula proves nothing — it passes with either sign — so this derives
 * the apex direction independently and checks all four cardinals. North/south alone are not
 * enough: they sit at 0deg/180deg, where the rotation sign is degenerate and a wrong sign
 * still looks correct. East/west are what discriminate.
 */

/** The wedge polygon's apex before rotation: screen-up, i.e. forward (Minimap.tsx). */
const APEX = { x: 0, y: -1 };

/** SVG rotate() is clockwise-positive in screen space (y-down). */
function rotate(p: { x: number; y: number }, deg: number): { x: number; y: number } {
  const r = (deg * Math.PI) / 180;
  return { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r) };
}

function rotationOf(transform: string): number {
  const m = /rotate\(([-\d.e]+)\)/.exec(transform);
  if (!m) throw new Error(`no rotate() in transform: ${transform}`);
  return Number(m[1]);
}

describe("Minimap wedge direction", () => {
  const scene: Scene = {
    nodes: [
      { id: "n", x: 0, y: 0, w: 100, h: 100, depth: 50, sides: 4, heat: 0, layer: "test", ring: null },
    ],
    links: [],
    regions: [],
  };

  // minimapProjection maps world +x -> screen +x and world +z -> screen +y, with no vertical
  // flip, so a camera facing world (dx, dz) should show an apex pointing screen (dx, dz).
  const cardinals: Array<{ name: string; dx: number; dz: number }> = [
    { name: "north (-z)", dx: 0, dz: -1 },
    { name: "south (+z)", dx: 0, dz: 1 },
    { name: "east (+x)", dx: 1, dz: 0 },
    { name: "west (-x)", dx: -1, dz: 0 },
  ];

  for (const { name, dx, dz } of cardinals) {
    it(`points ${name} when the camera faces ${name}`, () => {
      // heading is computed as atan2(dir.x, -dir.z) in Canvas3dHost.
      const heading = Math.atan2(dx, -dz);
      const viewer: Viewer = { x: 0, z: 0, heading };

      const { container } = render(<Minimap scene={scene} viewer={viewer} selection={null} />);
      const g = container.querySelector("svg > g");
      const transform = g?.getAttribute("transform");
      expect(transform).toBeTruthy();

      const apex = rotate(APEX, rotationOf(transform!));
      expect(apex.x).toBeCloseTo(dx, 6);
      expect(apex.y).toBeCloseTo(dz, 6);
    });
  }
});

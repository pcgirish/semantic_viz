import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { link } from "../src/link.js";
import type { SceneLink } from "@scv/layout";

function makeLink(overrides: Partial<SceneLink> & { from: string; to: string }): SceneLink {
  return {
    id: `${overrides.from}->${overrides.to}`,
    path: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    lane: 0,
    bundle: [],
    kind: "calls",
    state: "current",
    ...overrides,
  };
}

describe("link", () => {
  it("returns a Line following the routed path on the ground plane", () => {
    const l = link(makeLink({ from: "a", to: "b" }));
    expect(l).toBeInstanceOf(THREE.Line);
    const pos = l.geometry.getAttribute("position");
    expect(pos.count).toBe(2);
  });

  it("stays translucent (background) unless it touches the focused unit — occlusion cost paid explicitly", () => {
    const gated = link(makeLink({ from: "a", to: "b" }), { gated: true });
    const material = gated.material as THREE.LineBasicMaterial;
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeLessThan(1);
  });

  it("draws at full strength when it touches the focused unit even while gated", () => {
    const focused = link(makeLink({ from: "a", to: "b" }), { gated: true, focusId: "a" });
    const material = focused.material as THREE.LineBasicMaterial;
    expect(material.opacity).toBe(1);
  });
});

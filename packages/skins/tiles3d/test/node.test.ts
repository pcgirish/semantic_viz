import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { node } from "../src/node.js";
import type { SceneNode } from "@scv/layout";

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
  it("returns a THREE.Group positioned at the node's plane coordinates", () => {
    const g = node(makeNode({ id: "a", x: 10, y: 20 }));
    expect(g).toBeInstanceOf(THREE.Group);
    expect(g.name).toBe("a");
    expect(g.position.x).toBe(10 + 50); // centred on the tile's footprint
    expect(g.position.z).toBe(20 + 30);
  });

  it("extrudes a triangular prism for the trivial complexity bucket (sides=3)", () => {
    const g = node(makeNode({ id: "a", sides: 3 }));
    const mesh = g.getObjectByName("body") as THREE.Mesh;
    const geo = mesh.geometry as THREE.ExtrudeGeometry;
    expect(geo.type).toBe("ExtrudeGeometry");
    expect(geo.parameters.shapes.getPoints().length - 1).toBe(3);
  });

  it("extrudes a cylinder, not a prism, for the alarming bucket (sides=0)", () => {
    const g = node(makeNode({ id: "a", sides: 0 }));
    const mesh = g.getObjectByName("body") as THREE.Mesh;
    expect(mesh.geometry.type).toBe("CylinderGeometry");
  });

  it("extrudes hexagonal prisms for the involved bucket (sides=6)", () => {
    const g = node(makeNode({ id: "a", sides: 6 }));
    const mesh = g.getObjectByName("body") as THREE.Mesh;
    const geo = mesh.geometry as THREE.ExtrudeGeometry;
    expect(geo.parameters.shapes.getPoints().length - 1).toBe(6);
  });

  it("height (extrude depth) grows with depth, the layout engine's sloc-derived channel", () => {
    const short = node(makeNode({ id: "a", depth: 7 }));
    const tall = node(makeNode({ id: "b", depth: 304 }));
    const shortMesh = short.getObjectByName("body") as THREE.Mesh;
    const tallMesh = tall.getObjectByName("body") as THREE.Mesh;
    const shortDepth = (shortMesh.geometry as THREE.ExtrudeGeometry).parameters.options.depth as number;
    const tallDepth = (tallMesh.geometry as THREE.ExtrudeGeometry).parameters.options.depth as number;
    expect(tallDepth).toBeGreaterThan(shortDepth);
  });

  it("projects a beacon above the roofline when ring is true (high risk), not otherwise", () => {
    const risky = node(makeNode({ id: "a", ring: true }));
    const safe = node(makeNode({ id: "b", ring: false }));
    expect(risky.getObjectByName("beacon")).not.toBeUndefined();
    expect(safe.getObjectByName("beacon")).toBeUndefined();
  });
});

describe("node encoding channels", () => {
  it("takes height from n.depth, the layout engine's extrusion channel", () => {
    // layout.ts owns the encoding (docs/serve.md#1); the skin must not recompute it from sloc.
    const g = node(makeNode({ id: "a", depth: 123, sloc: 5 }));
    const mesh = g.getObjectByName("body") as THREE.Mesh;
    const geo = mesh.geometry as THREE.ExtrudeGeometry;
    expect(geo.parameters.options.depth).toBe(123);
  });

  it("paints the body with the layer hue supplied by the host", () => {
    const g = node(makeNode({ id: "a" }), { layerColor: "#3d7fff" });
    const mesh = g.getObjectByName("body") as THREE.Mesh;
    const material = mesh.material as THREE.MeshStandardMaterial;
    expect(`#${material.color.getHexString()}`).toBe("#3d7fff");
  });

  it("falls back to a neutral facade when no layer hue is known", () => {
    const g = node(makeNode({ id: "a" }));
    const mesh = g.getObjectByName("body") as THREE.Mesh;
    const material = mesh.material as THREE.MeshStandardMaterial;
    expect(material.color.getHexString()).not.toBe("ffffff");
  });

  it("tags the group with its scene node id so the host can raycast back to a unit", () => {
    const g = node(makeNode({ id: "pkg/a.ts:foo" }));
    expect(g.userData.sceneNodeId).toBe("pkg/a.ts:foo");
  });

  it("emits an added/removed/modified delta treatment distinct from no delta", () => {
    const plain = node(makeNode({ id: "a" }), { layerColor: "#3d7fff" });
    const added = node(makeNode({ id: "a" }), { layerColor: "#3d7fff", delta: { status: "added", amount: 1, risk: null } });
    const removed = node(makeNode({ id: "a" }), { layerColor: "#3d7fff", delta: { status: "removed", amount: 1, risk: null } });
    const modified = node(makeNode({ id: "a" }), { layerColor: "#3d7fff", delta: { status: "modified", amount: 1, risk: null } });
    const emissive = (g: THREE.Group) =>
      ((g.getObjectByName("body") as THREE.Mesh).material as THREE.MeshStandardMaterial).emissive.getHexString();
    expect(emissive(plain)).toBe("000000");
    expect(emissive(added)).not.toBe("000000");
    expect(emissive(removed)).not.toBe(emissive(added));
    expect(emissive(modified)).not.toBe(emissive(added));
  });

  it("scales the modified glow with the delta amount, so saturation still reads as magnitude", () => {
    const intensity = (amount: number) =>
      ((node(makeNode({ id: "a" }), { delta: { status: "modified", amount, risk: null } }).getObjectByName(
        "body",
      ) as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity;
    expect(intensity(0.9)).toBeGreaterThan(intensity(0.1));
  });

  it("fades a non-focused body when the scene is gated, and keeps the focused one solid", () => {
    const faint = node(makeNode({ id: "a" }), { gated: true, focusId: "b" });
    const solid = node(makeNode({ id: "a" }), { gated: true, focusId: "a" });
    const opacity = (g: THREE.Group) =>
      ((g.getObjectByName("body") as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity;
    expect(opacity(faint)).toBeLessThan(1);
    expect(opacity(solid)).toBe(1);
  });

  it("carries a CSS2D label object holding the unit name", () => {
    const g = node(makeNode({ id: "a", name: "resolveConfig" }));
    const label = g.getObjectByName("label");
    expect(label).not.toBeUndefined();
    expect((label as THREE.Object3D & { element: HTMLElement }).element.textContent).toBe("resolveConfig");
  });
});

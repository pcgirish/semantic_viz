import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { node } from "../src/node.js";
import type { SceneNode } from "@semviz/layout";

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

describe("buildings stand on the ground plane", () => {
  // Extruding a Shape runs along +z, so the rotation that lays the footprint flat decides
  // whether the building rises out of the ground or hangs beneath it. Getting this backwards
  // is invisible in an overview (you see a roof either way) and obvious the moment the
  // camera drops to street level, which is the whole point of the 3D view.
  function span(g: THREE.Group): { min: number; max: number } {
    const body = g.getObjectByName("body") as THREE.Mesh;
    body.geometry.computeBoundingBox();
    const box = body.geometry.boundingBox!;
    return { min: box.min.y, max: box.max.y };
  }

  it("extrudes a prism upward from y=0, not downward", () => {
    const { min, max } = span(node(makeNode({ id: "a", depth: 120, sides: 4 })));
    expect(min).toBeCloseTo(0);
    expect(max).toBeCloseTo(120);
  });

  it("extrudes a cylinder (the 13+ complexity bucket) upward from y=0 too", () => {
    const { min, max } = span(node(makeNode({ id: "a", depth: 120, sides: 0 })));
    expect(min).toBeCloseTo(0);
    expect(max).toBeCloseTo(120);
  });

  it("outlines a body's edges, so corner count still reads at street level", () => {
    // Footprint shape is the complexity channel, and a silhouette is a top-down cue: from eye
    // height, edge-on, a hexagon and an octagon are the same flat-shaded slab. A contrasting
    // line along the real edges puts the corner count back into the view the walker actually
    // has.
    const g = node(makeNode({ id: "a", depth: 120, sides: 6 }));
    const outline = g.getObjectByName("outline") as THREE.LineSegments;
    expect(outline).toBeInstanceOf(THREE.LineSegments);
    expect(outline.geometry.type).toBe("EdgesGeometry");
  });

  it("outlines the cylinder bucket too, without drawing every segment of its barrel", () => {
    // EdgesGeometry keys off the angle between adjacent faces, so a 24-segment barrel would
    // become 24 vertical lines and read as a hatched drum rather than a cylinder. Only the rim
    // circles should survive the threshold.
    const g = node(makeNode({ id: "a", depth: 120, sides: 0 }));
    const outline = g.getObjectByName("outline") as THREE.LineSegments;
    expect(outline).toBeInstanceOf(THREE.LineSegments);
    const prism = node(makeNode({ id: "b", depth: 120, sides: 6 })).getObjectByName("outline") as THREE.LineSegments;
    const segs = (o: THREE.LineSegments) => o.geometry.getAttribute("position").count / 2;
    expect(segs(outline)).toBeLessThan(segs(prism) * 8);
  });

  it("keeps the outline out of hit-testing, so it cannot steal a click from the body", () => {
    // Lines are picked within a threshold *around* them, so an outline sitting exactly on a
    // building's silhouette can win a raycast the body should have had. The host resolves a
    // hit to a unit either way, but only the body carries the surface the user aimed at.
    const g = node(makeNode({ id: "a", depth: 120, sides: 4 }));
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 60, 500), new THREE.Vector3(0, 0, -1));
    const hits = ray.intersectObject(g, true);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.object.name).toBe("body");
  });

  it("gives a prism a footprint that fills the tile rather than shrinking to its inradius", () => {
    // A 3-gon on the circumradius covers well under half the tile it replaces, so a
    // low-complexity unit reads as a spike instead of a building. The footprint should span
    // the tile's short side.
    const body = node(makeNode({ id: "a", w: 100, h: 60, depth: 40, sides: 3 })).getObjectByName(
      "body",
    ) as THREE.Mesh;
    body.geometry.computeBoundingBox();
    const box = body.geometry.boundingBox!;
    expect(box.max.x - box.min.x).toBeGreaterThan(50);
    expect(box.max.z - box.min.z).toBeGreaterThan(50);
  });
});

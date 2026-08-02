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

  it("height (extrude depth) grows with sloc, so height keeps meaning sloc", () => {
    const short = node(makeNode({ id: "a", sloc: 5 }));
    const tall = node(makeNode({ id: "b", sloc: 500 }));
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

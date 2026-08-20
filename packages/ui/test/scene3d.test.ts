import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { Scene } from "@scv/layout";
import { buildSceneGraph, disposeGraph, frameScene, unitAt } from "../src/scene3d.js";

function makeScene(): Scene {
  const node = (id: string, x: number, layer: string) => ({
    id,
    x,
    y: 0,
    w: 100,
    h: 60,
    depth: 30,
    sides: 3,
    heat: 0,
    ring: false,
    name: id,
    sloc: 10,
    fanIn: 0,
    fanOut: 0,
    layer,
    group: "",
    complexity: 0,
  });
  return {
    nodes: [node("a", 0, "edge"), node("b", 400, "domain")],
    links: [{ id: "a->b", from: "a", to: "b", weight: 1, path: [{ x: 50, y: 30 }, { x: 450, y: 30 }] }],
    regions: [],
    width: 600,
    height: 200,
  } as unknown as Scene;
}

describe("buildSceneGraph", () => {
  it("adds one group per scene node, tagged with its unit id", () => {
    const root = buildSceneGraph(makeScene(), {});
    const ids = root.children.filter((c) => c.userData.sceneNodeId).map((c) => c.userData.sceneNodeId);
    expect(ids).toEqual(["a", "b"]);
  });

  it("adds one line per scene link", () => {
    const root = buildSceneGraph(makeScene(), {});
    expect(root.children.filter((c) => c instanceof THREE.Line)).toHaveLength(1);
  });

  it("colours each building by its layer, so two layers are two hues", () => {
    const root = buildSceneGraph(makeScene(), {});
    const hue = (id: string) =>
      ((root.getObjectByName(id)!.getObjectByName("body") as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHexString();
    expect(hue("a")).not.toBe(hue("b"));
  });

  it("passes delta info through to the skin so delta mode reads in 3D", () => {
    const deltaByUnit = new Map([["a", { status: "added", amount: 1, risk: null }]]);
    const root = buildSceneGraph(makeScene(), { deltaByUnit });
    const emissive = (id: string) =>
      ((root.getObjectByName(id)!.getObjectByName("body") as THREE.Mesh).material as THREE.MeshStandardMaterial).emissive.getHexString();
    expect(emissive("a")).not.toBe("000000");
    expect(emissive("b")).toBe("000000");
  });
});

describe("disposeGraph", () => {
  it("disposes every geometry and material in the graph, so toggling skins cannot leak", () => {
    const root = buildSceneGraph(makeScene(), {});
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) geometries.push(m.geometry);
      if (m.material) materials.push(m.material as THREE.Material);
    });
    const geoSpies = geometries.map((g) => vi.spyOn(g, "dispose"));
    const matSpies = materials.map((m) => vi.spyOn(m, "dispose"));
    expect(geoSpies.length).toBeGreaterThan(0);

    disposeGraph(root);

    for (const s of geoSpies) expect(s).toHaveBeenCalled();
    for (const s of matSpies) expect(s).toHaveBeenCalled();
  });

  it("empties the root, so a rebuild does not stack a second copy of the city", () => {
    const root = buildSceneGraph(makeScene(), {});
    disposeGraph(root);
    expect(root.children).toHaveLength(0);
  });
});

describe("unitAt", () => {
  it("resolves a raycast hit on any mesh of a building back to its unit id", () => {
    const root = buildSceneGraph(makeScene(), {});
    const body = root.getObjectByName("a")!.getObjectByName("body")!;
    expect(unitAt(body)).toBe("a");
  });

  it("returns null for an object that belongs to no building", () => {
    expect(unitAt(new THREE.Mesh())).toBeNull();
  });
});

describe("frameScene", () => {
  it("places an orbit camera outside the city, looking at its centre", () => {
    const scene = makeScene();
    const { position, target } = frameScene(scene, "orbit");
    // Centre of the two buildings' footprints: x spans 0..500, y spans 0..60.
    expect(target.x).toBeCloseTo(250);
    expect(target.z).toBeCloseTo(30);
    expect(position.y).toBeGreaterThan(0);
    expect(position.distanceTo(target)).toBeGreaterThan(scene.nodes[0]!.w);
  });

  it("puts a street camera at eye height inside the city, not above it", () => {
    const scene = makeScene();
    const orbit = frameScene(scene, "street");
    expect(orbit.position.y).toBeGreaterThan(0);
    expect(orbit.position.y).toBeLessThan(30); // below the 30-unit rooflines
  });

  it("frames an empty scene without producing NaN", () => {
    const empty = { nodes: [], links: [], regions: [], width: 0, height: 0 } as unknown as Scene;
    const { position, target } = frameScene(empty, "orbit");
    for (const v of [position.x, position.y, position.z, target.x, target.y, target.z]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

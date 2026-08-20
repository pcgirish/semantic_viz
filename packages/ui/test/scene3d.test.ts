import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { Scene } from "@scv/layout";
import { applyFocus, buildSceneGraph, disposeGraph, frameScene, unitAt } from "../src/scene3d.js";

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

  it("removes CSS2D label elements from the DOM, so drilling does not leave the previous level's labels on screen", () => {
    // Labels are real DOM owned by the host's CSS2DRenderer, not GPU resources. Freeing
    // geometry does nothing for them: the element is only detached when its CSS2DObject
    // receives a "removed" event, and clearing the root never fires that for the nested
    // children it does not walk. Missing this leaves every scene you navigate away from
    // still labelled on top of the one you navigated to.
    const root = buildSceneGraph(makeScene(), {});
    const labels: HTMLElement[] = [];
    root.traverse((o) => {
      const el = (o as unknown as { element?: HTMLElement }).element;
      if (el) {
        document.body.appendChild(el);
        labels.push(el);
      }
    });
    expect(labels.length).toBeGreaterThan(0);

    disposeGraph(root);

    for (const el of labels) expect(el.isConnected).toBe(false);
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

  it("stands the street camera clear of the buildings rather than inside one", () => {
    // Eye height alone does not put you on a street. The footprint's near edge is where the
    // outermost building *is*, so framing there spawns the camera inside a facade and the
    // whole view is one flat colour. Standing off the near edge is what makes the first
    // frame legible.
    // A building at the far edge of the footprint, which is exactly where the street camera
    // stands. With every node at y=0 the camera lands in open ground by accident and the
    // bug hides.
    const scene = makeScene();
    // Centred on the footprint's x, because that is the column the street camera stands in.
    scene.nodes.push({ ...scene.nodes[0]!, id: "c", x: 200, y: 400 } as (typeof scene.nodes)[number]);
    const { position } = frameScene(scene, "street");
    // Distance to the nearest building's footprint edge, not its centre: a camera one pixel
    // outside a facade is still standing in the wall as far as the view is concerned.
    const clearance = Math.min(
      ...scene.nodes.map((n) => {
        const dx = Math.max(n.x - position.x, 0, position.x - (n.x + n.w));
        const dz = Math.max(n.y - position.z, 0, position.z - (n.y + n.h));
        return Math.hypot(dx, dz);
      }),
    );
    // A margin, not merely a non-overlap: standing flush against a facade fills the frame
    // with one colour just as thoroughly as standing inside it.
    expect(clearance).toBeGreaterThan(scene.nodes[0]!.h);
  });

  it("stands far enough back that tall buildings still fit the view", () => {
    // Clearance from the footprint is not enough on its own: once buildings are taller than
    // they are wide, a standoff measured only against ground extent puts you in an alley
    // between two towers. The approach has to scale with how tall the city is, the way you
    // naturally back up to take in a skyline.
    // Shaped like the real fixture: a compact footprint carrying buildings far taller than
    // the ground extent, which is the case a width-derived standoff gets wrong.
    const scene = makeScene();
    for (const n of scene.nodes) n.depth = 900;
    const tallest = Math.max(...scene.nodes.map((n) => n.depth));
    const { position, target } = frameScene(scene, "street");
    expect(position.distanceTo(target)).toBeGreaterThan(tallest);
  });

  it("stands back far enough that the city's width fits the frame, not just its height", () => {
    // The drilled levels are all a single rank row: one shallow strip of buildings, wider
    // than it is deep and often wider than it is tall. A standoff derived only from ground
    // *depth* and building *height* therefore ignores the one dimension that is actually
    // binding there, and parks the camera close enough that a single facade overflows the
    // viewport — the whole frame is one flat colour, which is precisely the failure this
    // whole framing exists to prevent.
    const scene = makeScene();
    scene.nodes.length = 1;
    const n = scene.nodes[0]!;
    n.x = 0;
    n.y = 0;
    n.w = 96;
    n.h = 96;
    n.depth = 40;
    const { position, target } = frameScene(scene, "street");
    // Half the frame's width at this distance, for the host's 60-degree vertical FOV at a
    // roughly square viewport. The facade has to fit inside it with room to spare.
    const distance = position.distanceTo(target);
    const visibleHalfWidth = distance * Math.tan((30 * Math.PI) / 180);
    expect(visibleHalfWidth).toBeGreaterThan(n.w);
  });

  it("frames an empty scene without producing NaN", () => {
    const empty = { nodes: [], links: [], regions: [], width: 0, height: 0 } as unknown as Scene;
    const { position, target } = frameScene(empty, "orbit");
    for (const v of [position.x, position.y, position.z, target.x, target.y, target.z]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("applyFocus", () => {
  it("fades the other buildings and keeps the focused one solid, without rebuilding", () => {
    const root = buildSceneGraph(makeScene(), {});
    const bodies = root.children
      .filter((c) => c.userData.sceneNodeId)
      .map((c) => c.getObjectByName("body") as THREE.Mesh);
    const before = bodies.map((m) => m.material);

    applyFocus(root, "a");

    const opacity = (id: string) =>
      ((root.getObjectByName(id)!.getObjectByName("body") as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity;
    expect(opacity("a")).toBe(1);
    expect(opacity("b")).toBeLessThan(1);
    // Same material objects: focus is a property change, not a reallocation, so clicking a
    // building must not churn the GPU by disposing and rebuilding the whole city.
    expect(bodies.map((m) => m.material)).toEqual(before);
  });

  it("brightens the edges touching the focused unit and fades the rest", () => {
    const root = buildSceneGraph(makeScene(), {});
    applyFocus(root, "a");
    const line = root.children.find((c) => c instanceof THREE.Line) as THREE.Line;
    // a->b touches the focused unit, so it must stay at full strength.
    expect((line.material as THREE.LineBasicMaterial).opacity).toBe(1);

    applyFocus(root, "unrelated");
    expect((line.material as THREE.LineBasicMaterial).opacity).toBeLessThan(1);
  });

  it("restores every building to solid when focus is cleared", () => {
    const root = buildSceneGraph(makeScene(), {});
    applyFocus(root, "a");
    applyFocus(root, null);
    for (const id of ["a", "b"]) {
      const material = (root.getObjectByName(id)!.getObjectByName("body") as THREE.Mesh)
        .material as THREE.MeshStandardMaterial;
      expect(material.opacity).toBe(1);
    }
  });
});

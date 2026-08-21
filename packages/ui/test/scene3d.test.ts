import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { Scene } from "@scv/layout";
import { applyFocus, buildSceneGraph, cullLabels, disposeGraph, disposeRenderer, frameScene, LABEL_MAX_DISTANCE, skin3d, unitAt } from "../src/scene3d.js";

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
    groupId: "",
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

describe("skin selection", () => {
  it("draws through whichever skin was named, not a hardcoded one", () => {
    // The host must not import a skin directly — it knows only that it holds something that
    // can draw a node and declares a camera model (docs/serve.md#6). If this collapses back
    // to a hardcoded tiles3d, the contract stops being exercised and becomes decoration.
    expect(skin3d("tiles3d").camera).toBe("orbit");
    expect(skin3d("cityscape").camera).toBe("walk");
  });

  it("gives the walkable skin a ground plane and the orbit skin none", () => {
    const walk = buildSceneGraph(makeScene(), { skin: "cityscape" });
    const orbit = buildSceneGraph(makeScene(), { skin: "tiles3d" });
    expect(walk.getObjectByName("ground")).toBeTruthy();
    expect(orbit.getObjectByName("ground")).toBeUndefined();
  });

  it("keeps the ground out of focus dimming and out of hit-testing", () => {
    // The floor is scenery, not a unit. Left untagged it would otherwise fade with the
    // buildings on every focus change, and a click on empty pavement would have to resolve
    // to something — when what it must do is ascend (docs/serve.md#4).
    const root = buildSceneGraph(makeScene(), { skin: "cityscape" });
    const groundGroup = root.getObjectByName("ground-group")!;
    expect(groundGroup.userData.sceneNodeId).toBeUndefined();
    expect(unitAt(root.getObjectByName("ground")!)).toBeNull();

    applyFocus(root, "a");
    const floor = root.getObjectByName("ground") as THREE.Mesh;
    expect((floor.material as THREE.MeshStandardMaterial).opacity).toBe(1);
  });

  it("frees the ground plane too, so the walkable skin does not leak a floor per rebuild", () => {
    const root = buildSceneGraph(makeScene(), { skin: "cityscape" });
    const floor = root.getObjectByName("ground") as THREE.Mesh;
    const spy = vi.spyOn(floor.geometry, "dispose");
    disposeGraph(root);
    expect(spy).toHaveBeenCalled();
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

describe("disposeRenderer", () => {
  // `renderer.dispose()` frees the GPU resources the renderer allocated, but it does not
  // release the WebGL context itself — that only happens via WEBGL_lose_context. Measured in
  // a real browser, 30 skin toggles created 30 contexts and the browser evicted 14 of them
  // with "Too many active WebGL contexts", one per toggle past the cap. Losing the context
  // deliberately on unmount is what keeps a long session off that cliff.
  function fakeRenderer() {
    return {
      dispose: vi.fn(),
      forceContextLoss: vi.fn(),
      domElement: document.createElement("canvas"),
    } as unknown as THREE.WebGLRenderer;
  }

  it("releases the WebGL context, not just the renderer's own resources", () => {
    const renderer = fakeRenderer();
    disposeRenderer(renderer);
    expect(renderer.dispose).toHaveBeenCalled();
    expect(renderer.forceContextLoss).toHaveBeenCalled();
  });

  it("detaches the canvas so a remount does not stack dead ones", () => {
    const renderer = fakeRenderer();
    document.body.appendChild(renderer.domElement);
    disposeRenderer(renderer);
    expect(renderer.domElement.isConnected).toBe(false);
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

  it("stops a faded building from writing depth, so it cannot occlude the focused one", () => {
    // Fading alone is not enough. A transparent mesh still writes to the depth buffer by
    // default, so a dimmed building standing in front of the focused one punches a hole in
    // it: you see through the facade to the background, not to the building behind. This is
    // the occlusion half of docs/serve.md#187-192.
    const root = buildSceneGraph(makeScene(), {});
    applyFocus(root, "a");

    const material = (id: string) =>
      (root.getObjectByName(id)!.getObjectByName("body") as THREE.Mesh).material as THREE.MeshStandardMaterial;

    expect(material("b").depthWrite).toBe(false);
    // The focused building is opaque and must keep writing depth, or it loses its own
    // self-occlusion and renders inside-out.
    expect(material("a").depthWrite).toBe(true);
  });

  it("restores depth writing when focus is cleared", () => {
    const root = buildSceneGraph(makeScene(), {});
    applyFocus(root, "a");
    applyFocus(root, null);
    for (const id of ["a", "b"]) {
      const material = (root.getObjectByName(id)!.getObjectByName("body") as THREE.Mesh)
        .material as THREE.MeshStandardMaterial;
      expect(material.depthWrite).toBe(true);
    }
  });

  it("draws the focused building last, so nothing faded paints over it", () => {
    // Focuses "a", which the builder puts *first*, so this fails on unchanged order rather
    // than passing by luck the way focusing the already-last "b" would.
    const root = buildSceneGraph(makeScene(), {});
    expect(root.children.filter((c) => typeof c.userData.sceneNodeId === "string")[0]!.userData.sceneNodeId).toBe("a");

    applyFocus(root, "a");

    const buildings = root.children.filter((c) => typeof c.userData.sceneNodeId === "string");
    expect(buildings[buildings.length - 1]!.userData.sceneNodeId).toBe("a");
  });

  it("never dims a risk beacon, which has to stay visible behind other geometry", () => {
    // Passes today because applyFocus only touches the mesh named "body", but that is a
    // property worth pinning: docs/serve.md requires the beacon "cannot be hidden behind the
    // thing you do not need to see", and a future change that fades whole groups would
    // silently break it. Needs a node flagged `ring`, which is what grows a beacon.
    const scene = makeScene();
    (scene.nodes[1] as { ring: boolean }).ring = true;
    const root = buildSceneGraph(scene, {});

    const beacons = root.children
      .map((c) => c.getObjectByName("beacon") as THREE.Mesh | undefined)
      .filter((m): m is THREE.Mesh => Boolean(m));
    expect(beacons.length).toBeGreaterThan(0);

    applyFocus(root, "a");

    for (const beacon of beacons) {
      expect((beacon.material as THREE.MeshBasicMaterial).opacity).toBe(1);
    }
  });
});

describe("cullLabels", () => {
  // Checkpoint 2 found `scripts`, `migrations_group`, and `src_db` colliding into unreadable
  // overlapping text in the middle of the frame. Distance is what causes it: far buildings
  // occupy a few pixels each while their labels stay full size, so the text crowds long
  // before the geometry does. Hiding the distant ones is the fix that keeps every label the
  // host does show legible.
  const labelOf = (root: THREE.Group, id: string) => root.getObjectByName(id)!.getObjectByName("label")!;

  const cameraAt = (z: number) => {
    const c = new THREE.PerspectiveCamera(60, 1, 1, 8000);
    c.position.set(0, 20, z);
    c.updateMatrixWorld();
    return c;
  };

  it("keeps the labels of nearby buildings visible", () => {
    const root = buildSceneGraph(makeScene(), {});
    cullLabels(root, cameraAt(30));
    expect(labelOf(root, "a").visible).toBe(true);
  });

  it("hides labels past the legibility distance", () => {
    const root = buildSceneGraph(makeScene(), {});
    cullLabels(root, cameraAt(LABEL_MAX_DISTANCE + 500));
    expect(labelOf(root, "a").visible).toBe(false);
    expect(labelOf(root, "b").visible).toBe(false);
  });

  it("culls per building, not per scene — walking toward one reveals its name", () => {
    const root = buildSceneGraph(makeScene(), {});
    // Standing beside `a`, with `b` 400 units further down the row: near enough to read the
    // building in front of you, too far to read the one at the end of the street.
    const camera = new THREE.PerspectiveCamera(60, 1, 1, 8000);
    camera.position.set(50 - (LABEL_MAX_DISTANCE - 200), 20, 30);
    camera.updateMatrixWorld();
    cullLabels(root, camera);
    expect(labelOf(root, "a").visible).toBe(true);
    expect(labelOf(root, "b").visible).toBe(false);
  });

  it("restores a label when the camera comes back within range", () => {
    const root = buildSceneGraph(makeScene(), {});
    cullLabels(root, cameraAt(LABEL_MAX_DISTANCE + 500));
    cullLabels(root, cameraAt(30));
    expect(labelOf(root, "a").visible).toBe(true);
  });
});

describe("cullLabels — screen-space collisions", () => {
  // Distance culling alone did not fix what Checkpoint 2 actually saw. `scripts`,
  // `migrations_group`, and `src_db` collided while all three were *near* the camera: they sit
  // side by side in one rank row, so from the street their labels project into overlapping
  // pixels no matter how close you stand. Distance is the wrong instrument for that; the
  // failure is in screen space, so the test has to be too.
  //
  // The rule: when two labels would overlap, the nearer building keeps its name. That is the
  // one you are walking toward, and dropping the far one costs the least.
  const cameraLookingAtOrigin = () => {
    const c = new THREE.PerspectiveCamera(60, 1, 1, 8000);
    c.position.set(250, 20, 900);
    c.lookAt(250, 20, 0);
    c.updateMatrixWorld();
    return c;
  };

  function crowded(): Scene {
    // Three buildings almost on top of each other in screen space: same rank row, and close
    // enough together that their labels cannot all be drawn.
    const node = (id: string, x: number) => ({
      id, x, y: 0, w: 100, h: 60, depth: 30, sides: 3, heat: 0, ring: false,
      name: `a-rather-long-unit-name-${id}`, sloc: 10, fanIn: 0, fanOut: 0,
      layer: "edge", groupId: "", complexity: 0,
    });
    return { nodes: [node("a", 200), node("b", 210), node("c", 220)], links: [], regions: [] } as unknown as Scene;
  }

  const shown = (root: THREE.Group) =>
    root.children
      .filter((c) => typeof c.userData.sceneNodeId === "string")
      .filter((c) => c.getObjectByName("label")?.visible)
      .map((c) => c.userData.sceneNodeId as string);

  it("drops labels that would overlap rather than drawing them on top of each other", () => {
    const root = buildSceneGraph(crowded(), {});
    cullLabels(root, cameraLookingAtOrigin());
    expect(shown(root).length).toBeLessThan(3);
    expect(shown(root).length).toBeGreaterThan(0);
  });

  it("keeps the nearest of a colliding pair, because that is the one you are walking toward", () => {
    const scene = crowded();
    const camera = new THREE.PerspectiveCamera(60, 1, 1, 8000);
    // Standing beside `a`, with `b` and `c` receding behind it along z.
    scene.nodes[1]!.y = 600;
    scene.nodes[2]!.y = 1200;
    scene.nodes[1]!.x = 200;
    scene.nodes[2]!.x = 200;
    camera.position.set(250, 20, -200);
    camera.lookAt(250, 20, 1200);
    camera.updateMatrixWorld();

    const root = buildSceneGraph(scene, {});
    cullLabels(root, camera);
    expect(shown(root)).toContain("a");
  });

  it("shows every label when nothing collides", () => {
    const root = buildSceneGraph(makeScene(), {});
    const camera = new THREE.PerspectiveCamera(60, 1, 1, 8000);
    camera.position.set(250, 200, 600);
    camera.lookAt(250, 0, 30);
    camera.updateMatrixWorld();
    cullLabels(root, camera);
    expect(shown(root).sort()).toEqual(["a", "b"]);
  });
});

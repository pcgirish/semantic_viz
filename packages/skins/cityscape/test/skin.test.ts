import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { SceneNode } from "@semviz/layout";
import { cityscapeSkin } from "../src/index.js";

function node(over: Partial<SceneNode> = {}): SceneNode {
  return {
    id: "u1",
    x: 0,
    y: 0,
    w: 96,
    h: 96,
    depth: 120,
    sides: 4,
    heat: 0,
    ring: false,
    name: "u1",
    sloc: 40,
    fanIn: 0,
    fanOut: 0,
    layer: "api",
    groupId: "",
    complexity: 3,
    ...over,
  } as unknown as SceneNode;
}

describe("cityscapeSkin", () => {
  it("declares a walk camera, the model that distinguishes it from tiles3d", () => {
    // tiles3d looks *at* the city from orbit; cityscape moves *through* it. The camera
    // model is the whole difference the contract can see, so it is what the host keys on
    // when deciding which controls to attach (docs/serve.md#6).
    expect(cityscapeSkin.camera).toBe("walk");
  });

  it("walks to a unit on focus and drill, rather than cutting to it", () => {
    // A cut would defeat the premise: the point of a walkable view is that travel is
    // visible, so arriving somewhere tells you where it is relative to where you were.
    expect(cityscapeSkin.navigate({ kind: "focus", unit: "u1" })).toEqual({
      kind: "walk-to",
      target: "u1",
    });
    expect(cityscapeSkin.navigate({ kind: "drill", unit: "u1" })).toEqual({
      kind: "walk-to",
      target: "u1",
    });
  });

  it("flies a trace rather than walking it", () => {
    // A trace is a path across the whole graph. Walking it at street level would take the
    // rank overview away exactly when the user asked to see a route, so travel switches to
    // fly (docs/serve.md#6 declares both models for this skin).
    expect(cityscapeSkin.navigate({ kind: "trace", path: ["a", "b"] })).toEqual({
      kind: "fly-path",
      path: ["a", "b"],
    });
  });

  it("walks back out to the overview on ascend, with no target", () => {
    expect(cityscapeSkin.navigate({ kind: "ascend" })).toEqual({ kind: "walk-to" });
  });

  it("reuses tiles3d's building geometry rather than inventing a second one", () => {
    // The encoding is not the skin's to reinterpret (docs/serve.md#1): footprint area is
    // sloc, sides are complexity, height is depth. Building a parallel extrusion here would
    // be a second place for those to drift out of agreement with tiles3d.
    const g = cityscapeSkin.node(node(), { layerColor: "#1FB6C1" }) as THREE.Group;
    expect(g.userData.sceneNodeId).toBe("u1");
    const body = g.getObjectByName("body") as THREE.Mesh;
    expect(body).toBeTruthy();
    expect(body.geometry.type).toBe("ExtrudeGeometry");
  });
});

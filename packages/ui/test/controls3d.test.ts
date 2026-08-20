import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { flyControls, orbitControls, walkControls } from "../src/controls3d.js";

const dom = () => document.createElement("div");

/**
 * Pointer lock and drag-to-look need a real browser, so these tests do not exercise input.
 * What they pin is the part a browser cannot check by eye and jsdom can: that the three
 * controllers present one interface to the host, and that walking keeps you on the ground.
 */
describe("controls3d", () => {
  it("gives orbit a target and withholds one from walk and fly", () => {
    // The host writes `target` only when the model has a look-at point; walk and fly carry
    // their heading on the camera itself. The presence of the field is the discriminator, so
    // it is load-bearing rather than incidental.
    const camera = new THREE.PerspectiveCamera();
    expect(orbitControls(camera, dom()).target).toBeInstanceOf(THREE.Vector3);
    expect(walkControls(camera, dom()).target).toBeUndefined();
    expect(flyControls(camera, dom()).target).toBeUndefined();
  });

  it("keeps the walker's eye height fixed when they look up and walk forward", () => {
    // PointerLockControls.moveForward follows the camera's full direction, pitch included, so
    // a user who looks at a roofline and walks would take off. Street level is the whole point
    // of the walk camera: losing the ground loses the view's reason to exist.
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 60, 0);
    camera.rotation.x = 0.9; // looking sharply up
    const controls = walkControls(camera, dom());

    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    controls.update(0.5);
    document.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" }));

    expect(camera.position.y).toBe(60);
    controls.dispose();
  });

  it("moves the walker along the ground when a key is held, and not otherwise", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 60, 0);
    const controls = walkControls(camera, dom());

    controls.update(0.5);
    expect(camera.position.z).toBe(0);

    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    controls.update(0.5);
    expect(camera.position.length()).toBeGreaterThan(60);
    document.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" }));
    controls.dispose();
  });

  it("stops responding to keys after dispose, so a swapped-out controller cannot steer", () => {
    // The host swaps controllers on every walk/fly toggle. A listener that outlives its
    // controller would move the camera from a mode the user has left.
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 60, 0);
    const controls = walkControls(camera, dom());
    controls.dispose();

    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    controls.update(0.5);
    expect(camera.position.toArray()).toEqual([0, 60, 0]);
  });
});

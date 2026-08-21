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

  /**
   * Fly-drag has to be reversible. Stock FlyControls reads the cursor's absolute offset from
   * the canvas centre and applies it as a rotation *rate*, so holding the pointer anywhere
   * off-centre spins the camera forever and dragging back only slows the spin. These pin the
   * delta-based replacement: a gesture and its reverse cancel, and a held-still pointer is
   * not a turn instruction.
   */
  describe("fly drag-to-look", () => {
    const CANVAS = { width: 800, height: 600 };

    function canvas(): HTMLElement {
      const el = document.createElement("div");
      el.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: CANVAS.width, height: CANVAS.height, right: CANVAS.width, bottom: CANVAS.height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      // jsdom lays nothing out, so every offset*/client* metric is 0 by default. They are
      // stubbed rather than left alone because a 0-width container makes stock FlyControls
      // divide by zero and rotate by NaN, which no assertion here would catch.
      for (const [prop, value] of [
        ["offsetWidth", CANVAS.width],
        ["offsetHeight", CANVAS.height],
        ["offsetLeft", 0],
        ["offsetTop", 0],
        ["clientWidth", CANVAS.width],
        ["clientHeight", CANVAS.height],
      ] as const) {
        Object.defineProperty(el, prop, { value });
      }
      return el;
    }

    // jsdom has no PointerEvent constructor; MouseEvent carries every field the controller
    // reads and dispatches under the pointer* type just the same. pageX/pageY are set
    // alongside clientX/clientY and are not decorative: stock FlyControls reads *page*
    // coordinates, and jsdom leaves those at 0 unless assigned, which would let these tests
    // pass against the very behaviour they exist to reject.
    function pointer(type: string, x: number, y: number): Event {
      const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true });
      Object.defineProperty(e, "pageX", { value: x });
      Object.defineProperty(e, "pageY", { value: y });
      return e;
    }

    function drag(el: HTMLElement, from: [number, number], to: [number, number]): void {
      el.dispatchEvent(pointer("pointerdown", from[0], from[1]));
      el.dispatchEvent(pointer("pointermove", to[0], to[1]));
      el.dispatchEvent(pointer("pointerup", to[0], to[1]));
    }

    it("returns the camera to its starting orientation when a drag is reversed", () => {
      const camera = new THREE.PerspectiveCamera();
      const el = canvas();
      const controls = flyControls(camera, el);
      const start = camera.quaternion.clone();

      drag(el, [400, 300], [600, 380]);
      controls.update(1 / 60);
      expect(camera.quaternion.angleTo(start)).toBeGreaterThan(0.01);

      drag(el, [600, 380], [400, 300]);
      controls.update(1 / 60);
      expect(camera.quaternion.angleTo(start)).toBeLessThan(0.001);

      controls.dispose();
    });

    it("does not keep turning while the pointer is held still off-centre", () => {
      const camera = new THREE.PerspectiveCamera();
      const el = canvas();
      const controls = flyControls(camera, el);

      el.dispatchEvent(pointer("pointerdown", 400, 300));
      el.dispatchEvent(pointer("pointermove", 700, 500));
      controls.update(1 / 60);
      const settled = camera.quaternion.clone();

      // Many frames pass with the pointer held exactly where it was pressed.
      for (let i = 0; i < 30; i++) controls.update(1 / 60);

      expect(camera.quaternion.angleTo(settled)).toBeLessThan(1e-6);
      controls.dispose();
    });

    it("ignores pointer movement when no button is held, so a resting cursor cannot steer", () => {
      const camera = new THREE.PerspectiveCamera();
      const el = canvas();
      const controls = flyControls(camera, el);
      const start = camera.quaternion.clone();

      el.dispatchEvent(pointer("pointermove", 700, 500));
      controls.update(1 / 60);

      expect(camera.quaternion.angleTo(start)).toBe(0);
      controls.dispose();
    });

    it("stops listening after dispose", () => {
      const camera = new THREE.PerspectiveCamera();
      const el = canvas();
      const controls = flyControls(camera, el);
      controls.dispose();
      const start = camera.quaternion.clone();

      drag(el, [400, 300], [600, 380]);
      controls.update(1 / 60);

      expect(camera.quaternion.angleTo(start)).toBe(0);
    });
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

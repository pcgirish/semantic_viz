import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FlyControls } from "three/examples/jsm/controls/FlyControls.js";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";

/**
 * What the host needs from a camera controller, and nothing more.
 *
 * The three controllers three.js ships do not share an interface: OrbitControls.update()
 * takes no argument, FlyControls.update() requires a delta, and PointerLockControls has no
 * movement of its own at all. Normalising them here keeps the render loop from branching on
 * which skin is active — the loop calls `update(dt)` and disposes, and the difference between
 * looking at a city and walking through one stays in this file.
 */
export type Controls3d = {
  update: (dt: number) => void;
  dispose: () => void;
  /** Present only for orbit, which is the one model with a look-at point the host reframes. */
  target?: THREE.Vector3;
};

/** Metres per second on foot, in scene units — a 96-wide tile crossed in about a third of a second. */
const WALK_SPEED = 320;

/** Faster, because flying exists to cover the whole city rather than one street. */
const FLY_SPEED = 900;

/**
 * Orbit: look *at* the city, the model `tiles3d` declares. The host reframes by writing
 * `target`, so this is the only kind that exposes one.
 */
export function orbitControls(camera: THREE.Camera, dom: HTMLElement): Controls3d {
  const c = new OrbitControls(camera, dom);
  c.enableDamping = true;
  return { update: () => c.update(), dispose: () => c.dispose(), target: c.target };
}

/**
 * Fly: travel across the city while keeping the overview. `dragToLook` rather than
 * always-look, so a pointer resting over the canvas does not swing the camera on its own.
 */
export function flyControls(camera: THREE.Camera, dom: HTMLElement): Controls3d {
  const c = new FlyControls(camera, dom);
  c.movementSpeed = FLY_SPEED;
  c.rollSpeed = 0.6;
  c.dragToLook = true;
  return { update: (dt) => c.update(dt), dispose: () => c.dispose() };
}

/**
 * Walk: WASD at eye height, mouse-look under pointer lock — the model that makes the view
 * feel like moving through a place rather than manipulating an object.
 *
 * PointerLockControls supplies looking but no movement, so the keys are ours. Motion is
 * deliberately confined to the ground plane: a walker who can drift upward is flying, and the
 * eye height is what makes the buildings tower rather than sit at waist level.
 *
 * The keydown listener sits on the document rather than the canvas because pointer lock takes
 * focus away from the element, so a canvas-scoped listener would stop hearing keys the moment
 * the user locked in and started walking.
 */
export function walkControls(camera: THREE.Camera, dom: HTMLElement): Controls3d {
  const c = new PointerLockControls(camera, dom);
  const held = new Set<string>();

  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
      if (down) held.add(k);
      else held.delete(k);
    }
  };
  const onDown = onKey(true);
  const onUp = onKey(false);
  const onClick = () => c.lock();

  document.addEventListener("keydown", onDown);
  document.addEventListener("keyup", onUp);
  dom.addEventListener("click", onClick);

  const forward = () => Number(held.has("w") || held.has("arrowup")) - Number(held.has("s") || held.has("arrowdown"));
  const strafe = () => Number(held.has("d") || held.has("arrowright")) - Number(held.has("a") || held.has("arrowleft"));

  return {
    update: (dt) => {
      const f = forward();
      const s = strafe();
      if (f === 0 && s === 0) return;
      const step = WALK_SPEED * dt;
      const y = camera.position.y;
      if (f !== 0) c.moveForward(f * step);
      if (s !== 0) c.moveRight(s * step);
      // Looking up must not lift you off the ground: moveForward follows the camera's
      // direction, including its pitch.
      camera.position.y = y;
    },
    dispose: () => {
      document.removeEventListener("keydown", onDown);
      document.removeEventListener("keyup", onUp);
      dom.removeEventListener("click", onClick);
      c.dispose();
    },
  };
}

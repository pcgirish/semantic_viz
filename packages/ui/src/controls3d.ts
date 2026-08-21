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

/** Radians of camera rotation per pixel dragged. Tuned so crossing the canvas turns ~180°. */
const FLY_LOOK_SENSITIVITY = 0.004;

/** Just short of straight up/down, so the horizon can never flip past vertical. */
const MAX_PITCH = Math.PI / 2 - 0.01;

/**
 * Fly: travel across the city while keeping the overview.
 *
 * `FlyControls` supplies the movement — WASD/arrows plus R/F, which is the whole point of the
 * mode — but its looking is unusable and is turned off here. Stock reads the cursor's
 * *absolute offset from the canvas centre* and feeds it to `update()` as a rotation **rate**,
 * so holding the pointer anywhere off-centre spins the camera continuously and dragging back
 * toward centre only slows the spin rather than unwinding it. No cursor position returns the
 * camera to where it started, which is what made fly mode "only move away, hard to reverse".
 *
 * Looking is therefore ours: a drag delta maps to a fixed rotation, so a gesture and its
 * reverse cancel exactly. Yaw is applied in world space and pitch in camera space, which is
 * what keeps the horizon level — composing both locally would let repeated diagonal drags
 * accumulate roll.
 */
export function flyControls(camera: THREE.Camera, dom: HTMLElement): Controls3d {
  const c = new FlyControls(camera, dom);
  c.movementSpeed = FLY_SPEED;
  c.rollSpeed = 0;
  // Leaves stock's pointer handlers installed but inert: with dragToLook on, onPointerMove
  // only writes rotation state while `_status > 0`, and that counter is only raised by the
  // pointerdown listener we stop below.
  c.dragToLook = true;

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let yaw = 0;
  let pitch = 0;

  // Seeded from the camera's current facing so the first drag continues from where the host
  // pointed it, rather than snapping to level.
  const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
  yaw = euler.y;
  pitch = euler.x;

  const apply = () => {
    camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
  };

  // Capture-phase, so stock's own pointerdown never sees the event and never raises the
  // `_status` counter that would re-enable its rate-based looking.
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  };

  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    e.stopPropagation();
    yaw -= (e.clientX - lastX) * FLY_LOOK_SENSITIVITY;
    pitch = THREE.MathUtils.clamp(pitch - (e.clientY - lastY) * FLY_LOOK_SENSITIVITY, -MAX_PITCH, MAX_PITCH);
    lastX = e.clientX;
    lastY = e.clientY;
    apply();
  };

  const onUp = () => {
    dragging = false;
  };

  dom.addEventListener("pointerdown", onDown, true);
  dom.addEventListener("pointermove", onMove, true);
  // On window rather than the canvas: releasing outside the element must still end the drag,
  // or the camera keeps turning after the button is up.
  window.addEventListener("pointerup", onUp);

  return {
    update: (dt) => c.update(dt),
    dispose: () => {
      dom.removeEventListener("pointerdown", onDown, true);
      dom.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp);
      c.dispose();
    },
  };
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

  // Keyed on `code`, not `key`: WASD is a *position* on the keyboard, not four letters. On a
  // French or Dvorak layout `key` reports different characters for the same physical keys, and
  // the user would find their movement keys scattered.
  const MOVE_KEYS = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    if (!MOVE_KEYS.includes(e.code)) return;
    if (down) held.add(e.code);
    else held.delete(e.code);
  };
  const onDown = onKey(true);
  const onUp = onKey(false);
  const onClick = () => c.lock();

  document.addEventListener("keydown", onDown);
  document.addEventListener("keyup", onUp);
  dom.addEventListener("click", onClick);

  const forward = () => Number(held.has("KeyW") || held.has("ArrowUp")) - Number(held.has("KeyS") || held.has("ArrowDown"));
  const strafe = () => Number(held.has("KeyD") || held.has("ArrowRight")) - Number(held.has("KeyA") || held.has("ArrowLeft"));

  return {
    update: (dt) => {
      const f = forward();
      const s = strafe();
      if (f === 0 && s === 0) return;
      const step = WALK_SPEED * dt;
      // moveForward/moveRight read `camera.matrix`, which the render loop refreshes *after*
      // controls run. Updating it here makes a step use the heading the user is looking along
      // now rather than the one from the previous frame, and keeps the controller correct
      // independently of where the host chooses to call it.
      camera.updateMatrixWorld();
      // Both moves are already parallel to the xz-plane, so looking up cannot lift the walker
      // off the ground and no eye-height correction is needed.
      if (f !== 0) c.moveForward(f * step);
      if (s !== 0) c.moveRight(s * step);
    },
    dispose: () => {
      document.removeEventListener("keydown", onDown);
      document.removeEventListener("keyup", onUp);
      dom.removeEventListener("click", onClick);
      c.dispose();
    },
  };
}

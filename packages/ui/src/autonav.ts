/**
 * Camera distance as a navigation verb.
 *
 * The user's expectation was that zooming into a block reveals its parts — "zoom in, and it
 * breaks apart". `Scene` is deliberately flat (`packages/layout/src/scene.ts`, no parent/child
 * field), so there is no geometric level-of-detail to uncover: drilling swaps which flat Scene
 * is loaded. What this does instead is fire the *existing* discrete drill/ascend intents when
 * the camera crosses a distance threshold, reusing the navigation machinery double-click
 * already drives rather than inventing a second data model.
 *
 * Kept as a pure function, separate from the host, for one reason: the failure mode here is
 * oscillation, and oscillation is only testable if the decision can be driven frame by frame
 * without a live Three.js scene.
 */

import * as THREE from "three";

/** Closer than this to the focused building and the camera drills into it. */
export const DRILL_DISTANCE = 150;

/**
 * How much further than it has ever been the camera must retreat before an auto-drilled level
 * is left again. A *relative* margin, not an absolute distance: drilling reframes the camera to
 * fit the new level, and that framing distance scales with the scene, so any fixed threshold is
 * already exceeded on arrival for anything sizeable — the camera would drill in and bounce
 * straight back out. Measured against where the camera has actually been, arriving far away is
 * not retreating. The margin is wide enough that ordinary drifting cannot cross it, which is
 * what stops drill and ascend alternating at a boundary.
 */
export const ASCEND_DISTANCE = 400;

export type AutoNavState = {
  /** Whether the current level was entered by this mechanism rather than by the user. */
  drilled: boolean;
  /**
   * The closest the camera has come since arriving at this level, and the datum retreat is
   * judged against. `Infinity` until the first measured frame, so arrival itself sets it.
   */
  nearest: number;
  /**
   * Set when this mechanism has just fired a navigation and the resulting focus change has not
   * arrived yet; the host clears it when that focus change lands.
   *
   * It does two jobs, both about that in-between window. It suppresses measurement, since every
   * frame in it describes the level being left rather than the one being entered. And it tells
   * the host which focus changes are its own: the host clears `drilled` on any focus change it
   * did not cause, and without this it would clear the flag it had just set, leaving the camera
   * unable to ascend back out of a level it drilled into.
   */
  pending?: boolean;
};

export type AutoNavIntent = "drill" | "ascend" | null;

/**
 * Decides what the camera's distance implies, or `null` for "leave navigation alone" — which is
 * the answer for most frames and must stay the cheap default.
 */
export function computeAutoNavIntent(distance: number, state: AutoNavState, facing = true): AutoNavIntent {
  // A caller with no building in range hands us NaN or Infinity. Treating either as "very far"
  // would ascend out of a level for no reason.
  if (!Number.isFinite(distance)) return null;
  // Between firing an intent and the new level arriving, every frame still measures the camera
  // against the graph being left. Those distances describe nowhere the user is going, and the
  // sequence they produce — very close as the approach finishes, then very far as the reframe
  // lands — reads as a retreat and trips the opposite intent. Waiting out that window is what
  // makes a drill stick.
  if (state.pending) return null;
  if (distance < state.nearest) state.nearest = distance;
  if (!state.drilled && distance < DRILL_DISTANCE) {
    // Deciding to navigate means the level is about to change, so the datum the old level
    // established no longer describes anywhere. The new level arrives a frame or more later;
    // carrying the old low-water mark into those frames is exactly what would let them read the
    // reframed distance as a retreat and undo the move.
    state.nearest = Number.POSITIVE_INFINITY;
    state.pending = true;
    return "drill";
  }
  // Only unwind what this mechanism did, and only once the camera has gone measurably further
  // than it ever was here. Pulling back in a view the user navigated to by hand must not undo
  // their navigation, and a round trip out to where you started is not leaving.
  // Growing distance has two quite different causes, and distance alone cannot tell them
  // apart. The user may be backing off — the retreat this answers — or they may simply have
  // held the forward key through the drill and flown out the far side of the small level they
  // just entered, which at fly speed takes well under a second. Facing is what separates them:
  // backing away keeps the level in front of you, flying through leaves it behind. Without
  // this the drill appears not to work at all, because the same keypress that triggers it
  // carries the camera straight back out again.
  if (state.drilled && facing && distance > state.nearest + ASCEND_DISTANCE) {
    state.nearest = Number.POSITIVE_INFINITY;
    state.pending = true;
    return "ascend";
  }
  return null;
}

const centre = new THREE.Vector3();
const box = new THREE.Box3();

/**
 * How far the camera is from the selected building's centre, or `Infinity` when there is
 * nothing to measure to.
 *
 * Measuring to the *selection* rather than to whatever is nearest is the point: auto-drilling
 * into the closest building would navigate somewhere the user never pointed at, which is the
 * difference between a zoom that follows your attention and one that hijacks it.
 */
export function distanceToSelection(
  graph: THREE.Object3D | undefined,
  selection: string | null,
  camera: THREE.Camera,
): number {
  if (!graph || !selection) return Number.POSITIVE_INFINITY;
  const target = graph.children.find((c) => c.userData.sceneNodeId === selection);
  // A rebuild can leave `selection` naming a unit from the previous scene for a frame.
  if (!target) return Number.POSITIVE_INFINITY;
  // The group's origin sits at a building's corner, not its middle; measuring to the corner
  // would fire the threshold early for a wide footprint and late for a narrow one.
  box.setFromObject(target);
  if (box.isEmpty()) return Number.POSITIVE_INFINITY;
  box.getCenter(centre);
  return camera.position.distanceTo(centre);
}

/**
 * How far the camera is from the middle of the whole level.
 *
 * The way *out* cannot be measured the same way as the way in. Drilling clears the selection,
 * so the distance that triggered the drill is gone the instant it succeeds — measured against
 * the selection, the return trip would be `Infinity` forever and the camera could never leave
 * a level it had just entered. Measured against the level as a whole, retreating from it means
 * what it looks like it means.
 */
const forward = new THREE.Vector3();
const toCentre = new THREE.Vector3();

/**
 * Whether the level is in front of the camera rather than behind it.
 *
 * This is what makes "the camera is getting further away" mean something. Retreating from a
 * level and flying onward through it both increase the distance, but only one of them is
 * leaving the way you came: back off and the level stays ahead of you; fly through and it
 * ends up behind. `true` when there is nothing to measure, so an unknown facing never blocks
 * an ascend that distance alone justifies.
 */
export function facingLevel(graph: THREE.Object3D | undefined, camera: THREE.Camera): boolean {
  if (!graph || graph.children.length === 0) return true;
  box.setFromObject(graph);
  if (box.isEmpty()) return true;
  box.getCenter(toCentre).sub(camera.position);
  camera.getWorldDirection(forward);
  return forward.dot(toCentre) > 0;
}

export function distanceToLevel(graph: THREE.Object3D | undefined, camera: THREE.Camera): number {
  if (!graph || graph.children.length === 0) return Number.POSITIVE_INFINITY;
  box.setFromObject(graph);
  if (box.isEmpty()) return Number.POSITIVE_INFINITY;
  box.getCenter(centre);
  return camera.position.distanceTo(centre);
}

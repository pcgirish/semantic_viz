import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  ASCEND_DISTANCE,
  computeAutoNavIntent,
  distanceToLevel,
  distanceToSelection,
  facingLevel,
  DRILL_DISTANCE,
  type AutoNavIntent,
  type AutoNavState,
} from "../src/autonav.js";

/**
 * Zoom-to-drill is the one navigation verb the user expected and did not get: "zoom in, and it
 * breaks apart." The risk in wiring camera distance to a navigation action is oscillation — a
 * camera resting near the threshold would drill and ascend on alternate frames, which is worse
 * than no auto-navigation at all. So the thresholds form a hysteresis band, and the state
 * machine that decides is a pure function, testable without a live Three.js scene.
 */

const state = (over: Partial<AutoNavState> = {}): AutoNavState => ({ drilled: false, nearest: Number.POSITIVE_INFINITY, ...over });

/** Feeds a sequence of per-frame distances and returns the intents they produced. */
const run = (s: AutoNavState, distances: number[]): AutoNavIntent[] =>
  distances.map((d) => computeAutoNavIntent(d, s));

describe("computeAutoNavIntent", () => {
  it("drills once the camera comes closer than the drill threshold", () => {
    expect(computeAutoNavIntent(DRILL_DISTANCE - 1, state())).toBe("drill");
  });

  it("does nothing at a comfortable working distance", () => {
    const mid = (DRILL_DISTANCE + ASCEND_DISTANCE) / 2;
    expect(computeAutoNavIntent(mid, state())).toBe(null);
    expect(computeAutoNavIntent(mid, state({ drilled: true, nearest: mid }))).toBe(null);
  });

  it("ascends once the camera pulls back a full band beyond where it arrived", () => {
    const s = state({ drilled: true, nearest: 100 });
    expect(computeAutoNavIntent(100 + ASCEND_DISTANCE + 1, s)).toBe("ascend");
  });

  it("does not ascend straight back out of a level it has just entered", () => {
    // The bounce this whole mechanism has to survive. Drilling reframes the camera to fit the
    // new level, and that framing distance scales with the scene — for anything sizeable it
    // lands beyond a fixed ASCEND_DISTANCE on the very first frame. Judged against a fixed
    // threshold the camera would drill in and bounce straight back out, which reads to the user
    // as the drill simply not working. Judged against where it arrived, arriving far away is
    // not retreating.
    const s = state({ drilled: true });
    const arrival = ASCEND_DISTANCE * 2;
    expect(computeAutoNavIntent(arrival, s)).toBe(null);
    // Nor does hovering around that arrival distance count as leaving.
    expect(run(s, [arrival + 20, arrival - 20, arrival + 50])).toEqual([null, null, null]);
  });

  it("measures the way out from the closest the camera has been, not from where it started", () => {
    // Flying in and then back out to the same place is a round trip, not an exit; only going
    // meaningfully further than you ever were is leaving.
    const s = state({ drilled: true });
    expect(run(s, [1000, 300])).toEqual([null, null]);
    expect(s.nearest).toBe(300);
    expect(computeAutoNavIntent(690, s)).toBe(null);
    expect(computeAutoNavIntent(701, s)).toBe("ascend");
  });

  it("rearms cleanly after each decision, so one approach cannot cascade", () => {
    // The host applies an intent and the new level arrives asynchronously, a frame or more
    // later. Those in-between frames still measure the old camera against the new level; if the
    // decision left its own history behind, they would immediately fire the opposite intent.
    const drilling = state({ nearest: 40 });
    expect(computeAutoNavIntent(DRILL_DISTANCE - 1, drilling)).toBe("drill");
    expect(drilling.nearest).toBe(Number.POSITIVE_INFINITY);

    const ascending = state({ drilled: true, nearest: 100 });
    expect(computeAutoNavIntent(100 + ASCEND_DISTANCE + 1, ascending)).toBe("ascend");
    expect(ascending.nearest).toBe(Number.POSITIVE_INFINITY);
  });

  it("stays silent while a navigation it fired is still in flight", () => {
    // The decisive frames are the ones between firing an intent and the new level arriving.
    // They still measure the camera against the *old* graph, and the numbers they produce are
    // about a place the user is already leaving: first a very small distance as the camera
    // finishes its approach, then a large one once the reframe lands. Taken at face value that
    // pair reads as "went right up to it, then fled", and trips the opposite intent — the
    // camera drills in and pops straight back out. Nothing measured in that window is about
    // anywhere real, so none of it is allowed to inform a decision or move the datum.
    const s = state({ drilled: true, pending: true });
    expect(run(s, [5, 5000])).toEqual([null, null]);
    expect(s.nearest).toBe(Number.POSITIVE_INFINITY);
  });

  it("does not ascend from a camera still flying forward through the level it just entered", () => {
    // Observed in the browser, and the reason auto-drill appeared not to work at all. The user
    // holds forward to approach a building; the drill fires and reframes them into the new
    // level. But the key is still down, so the camera keeps its velocity and flies straight
    // through that level and out the far side. Measured from the middle of the level, the
    // distance falls to a minimum as they pass the centre and then climbs without bound — and
    // a climb past the band reads as a deliberate retreat, so the camera pops back out and the
    // drill looks like it never happened.
    //
    // Distance alone cannot tell the two apart — both are a rising number. What separates them
    // is where the camera is looking: backing off keeps the level in front of you, flying
    // through leaves it behind. So the decision takes the camera's facing as well, and only
    // treats growing distance as retreat while the level is still ahead.
    const s = state({ drilled: true });
    const through = [49, 22, 108, 257, 406, 437, 900].map((d) => computeAutoNavIntent(d, s, false));
    expect(through).toEqual([null, null, null, null, null, null, null]);
  });

  it("still ascends when the camera backs away with the level in front of it", () => {
    // The counterpart to the test above: the same rising distances, but facing the level, is
    // the genuine retreat the mechanism exists to answer.
    const s = state({ drilled: true });
    expect(computeAutoNavIntent(49, s, true)).toBe(null);
    expect(computeAutoNavIntent(49 + ASCEND_DISTANCE + 1, s, true)).toBe("ascend");
  });

  it("never drills twice for one approach", () => {
    // Without this the camera would fire drill on every frame it spends up close, walking the
    // user down through the whole hierarchy in a fraction of a second.
    expect(computeAutoNavIntent(DRILL_DISTANCE - 1, state({ drilled: true, nearest: 10 }))).toBe(null);
  });

  it("never ascends from a level it did not auto-drill into", () => {
    // Pulling back in a view the user navigated to by hand must not undo their navigation.
    expect(computeAutoNavIntent(ASCEND_DISTANCE * 3, state({ nearest: 100 }))).toBe(null);
  });

  it("does not oscillate for a camera drifting around one spot", () => {
    // The failure this design exists to rule out: a camera near a boundary firing drill and
    // ascend on alternate frames. Jitter around a fixed point must be silent for a whole run,
    // not merely on a single frame — a stateful rule can pass frame-by-frame checks and still
    // ring, because each decision moves the goalposts for the next.
    const jitter = Array.from({ length: 200 }, (_, i) => 300 + Math.sin(i) * 40);
    expect(run(state(), jitter).every((i) => i === null)).toBe(true);
    expect(run(state({ drilled: true }), jitter).every((i) => i === null)).toBe(true);
  });

  it("leaves a gap between the thresholds wide enough to rest in", () => {
    // A band this size is what makes the test above meaningful rather than vacuous.
    expect(ASCEND_DISTANCE).toBeGreaterThan(DRILL_DISTANCE * 2);
  });

  it("ignores a distance it cannot trust rather than guessing", () => {
    // No building in range yields NaN/Infinity from the caller's distance computation. Acting
    // on that would drill into whatever happened to be selected.
    expect(computeAutoNavIntent(Number.NaN, state())).toBe(null);
    expect(computeAutoNavIntent(Number.POSITIVE_INFINITY, state({ drilled: true, nearest: 100 }))).toBe(null);
  });
});

describe("distanceToSelection", () => {
  function graph(): THREE.Group {
    const root = new THREE.Group();
    for (const [id, x] of [
      ["near", 100],
      ["far", 1000],
    ] as const) {
      const child = new THREE.Group();
      child.userData.sceneNodeId = id;
      child.position.set(x, 0, 0);
      child.add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10)));
      root.add(child);
    }
    return root;
  }

  const camera = (x: number): THREE.Camera => {
    const c = new THREE.PerspectiveCamera();
    c.position.set(x, 0, 0);
    return c;
  };

  it("measures to the selected building, not the nearest one", () => {
    // The whole mechanism hangs on this: drilling into whatever happens to be closest would
    // navigate somewhere the user never pointed at.
    expect(distanceToSelection(graph(), "far", camera(0))).toBeCloseTo(1000, 0);
  });

  it("is Infinity when nothing is selected, so no intent can fire", () => {
    expect(distanceToSelection(graph(), null, camera(0))).toBe(Number.POSITIVE_INFINITY);
  });

  it("is Infinity when the selection is not in the graph", () => {
    // Happens for a frame after a rebuild, while selection still names the old scene's unit.
    expect(distanceToSelection(graph(), "gone", camera(0))).toBe(Number.POSITIVE_INFINITY);
  });

  it("is Infinity with no graph at all", () => {
    expect(distanceToSelection(undefined, "near", camera(0))).toBe(Number.POSITIVE_INFINITY);
  });

  it("shrinks as the camera approaches", () => {
    const g = graph();
    expect(distanceToSelection(g, "near", camera(90))).toBeLessThan(distanceToSelection(g, "near", camera(0)));
  });
});

describe("distanceToLevel", () => {
  // Drilling clears the selection, so the distance that drove the drill is gone the moment it
  // succeeds. Measuring the way back out against the selection would therefore always be
  // Infinity, and the camera could never ascend from a level it had just entered. The way out
  // is measured against the level as a whole instead.
  function graph(): THREE.Group {
    const root = new THREE.Group();
    for (const [id, x] of [
      ["a", 0],
      ["b", 200],
    ] as const) {
      const child = new THREE.Group();
      child.userData.sceneNodeId = id;
      child.position.set(x, 0, 0);
      child.add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10)));
      root.add(child);
    }
    return root;
  }

  const camera = (x: number): THREE.Camera => {
    const c = new THREE.PerspectiveCamera();
    c.position.set(x, 0, 0);
    return c;
  };

  it("measures from the middle of the level, not from any one building", () => {
    // The level spans x=0..200, so its centre is x=100.
    expect(distanceToLevel(graph(), camera(100))).toBeCloseTo(0, 0);
    expect(distanceToLevel(graph(), camera(600))).toBeCloseTo(500, 0);
  });

  it("grows as the camera retreats, so pulling back can cross the ascend threshold", () => {
    const g = graph();
    expect(distanceToLevel(g, camera(1000))).toBeGreaterThan(distanceToLevel(g, camera(300)));
  });

  it("is Infinity for an empty or missing level, so no intent can fire", () => {
    expect(distanceToLevel(new THREE.Group(), camera(0))).toBe(Number.POSITIVE_INFINITY);
    expect(distanceToLevel(undefined, camera(0))).toBe(Number.POSITIVE_INFINITY);
  });

  describe("facingLevel", () => {
    // The level built above spans x=0..200, so its centre is at x=100.
    const aimed = (x: number, towardsPlusX: boolean): THREE.Camera => {
      const c = new THREE.PerspectiveCamera();
      c.position.set(x, 0, 0);
      c.lookAt(x + (towardsPlusX ? 1 : -1), 0, 0);
      return c;
    };

    it("is true for a camera that has backed off but still looks at the level", () => {
      expect(facingLevel(graph(), aimed(-500, true))).toBe(true);
    });

    it("is false once the camera has flown past and left the level behind", () => {
      expect(facingLevel(graph(), aimed(700, true))).toBe(false);
    });

    it("is true when there is nothing to measure, so facing never blocks an ascend on its own", () => {
      expect(facingLevel(new THREE.Group(), aimed(0, true))).toBe(true);
      expect(facingLevel(undefined, aimed(0, true))).toBe(true);
    });
  });
});

import { describe, expect, it } from "vitest";
import { route } from "../src/route.js";
import type { Box } from "../src/place.js";
import type { Chain } from "../src/expand.js";

describe("route", () => {
  const boxes = new Map<string, Box>([
    ["a", { x: 0, y: 0, w: 40, h: 40 }],
    ["b", { x: 100, y: 100, w: 40, h: 40 }],
    ["c", { x: 200, y: 100, w: 40, h: 40 }],
  ]);

  function chain(from: string, to: string, ids: string[], nodes = [from, to]): Chain & { id: string; ids: string[]; kind: string } {
    return { from, to, nodes, id: ids[0]!, ids, kind: "calls" };
  }

  it("produces one link per chain with an id, from, to, and a path", () => {
    const links = route([chain("a", "b", ["e1"])], boxes);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ id: "e1", from: "a", to: "b", kind: "calls" });
    expect(links[0]!.path.length).toBeGreaterThanOrEqual(2);
  });

  it("bundles multiple edges between the same box pair into one link with a weight label", () => {
    const links = route(
      [chain("a", "b", ["e1"]), chain("a", "b", ["e2"]), chain("a", "b", ["e3"])],
      boxes,
    );
    expect(links).toHaveLength(1);
    expect(links[0]!.bundle).toEqual(["e1", "e2", "e3"]);
  });

  it("assigns distinct lanes to parallel edges that share a source but diverge, so they never share a y", () => {
    const links = route([chain("a", "b", ["e1"]), chain("a", "c", ["e2"])], boxes);
    const lanes = links.map((l) => l.lane);
    expect(new Set(lanes).size).toBe(lanes.length);
  });

  it("orders lanes by target x (left-to-right sweep)", () => {
    const links = route([chain("a", "c", ["e_to_c"]), chain("a", "b", ["e_to_b"])], boxes);
    const toB = links.find((l) => l.to === "b")!;
    const toC = links.find((l) => l.to === "c")!;
    expect(toB.lane).toBeLessThan(toC.lane);
  });

  it("skips chains referencing unknown boxes rather than throwing", () => {
    const links = route([chain("a", "missing", ["e1"])], boxes);
    expect(links).toHaveLength(0);
  });

  it("routes a multi-hop chain through its dummy waypoints instead of a straight from-to line", () => {
    const dummyBoxes = new Map<string, Box>([
      ["a", { x: 0, y: 0, w: 40, h: 40 }],
      ["~dummy~a|d|1", { x: 500, y: 100, w: 6, h: 100 }], // deliberately off the straight line
      ["d", { x: 0, y: 300, w: 40, h: 40 }],
    ]);
    const links = route([chain("a", "d", ["e1"], ["a", "~dummy~a|d|1", "d"])], dummyBoxes);
    expect(links).toHaveLength(1);
    // path must bend toward the dummy's x, not go straight from a's centre to d's centre
    const xs = links[0]!.path.map((p) => p.x);
    expect(Math.max(...xs)).toBeGreaterThan(400);
  });

  it("spreads multiple out-edges across a node's bottom border instead of converging on its centre", () => {
    const fan = new Map<string, Box>([
      ["hub", { x: 0, y: 0, w: 200, h: 40 }],
      ["left", { x: -100, y: 100, w: 40, h: 40 }],
      ["right", { x: 300, y: 100, w: 40, h: 40 }],
    ]);
    const links = route([chain("hub", "left", ["e1"]), chain("hub", "right", ["e2"])], fan);
    const toLeft = links.find((l) => l.to === "left")!;
    const toRight = links.find((l) => l.to === "right")!;
    // first path point is the origin port on hub's border; they must not be the same pixel
    expect(toLeft.path[0]!.x).not.toBe(toRight.path[0]!.x);
  });
});

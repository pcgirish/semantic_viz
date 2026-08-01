import { describe, expect, it } from "vitest";
import { route } from "../src/route.js";
import type { Box } from "../src/place.js";

describe("route", () => {
  const boxes = new Map<string, Box>([
    ["a", { x: 0, y: 0, w: 40, h: 40 }],
    ["b", { x: 100, y: 100, w: 40, h: 40 }],
    ["c", { x: 200, y: 100, w: 40, h: 40 }],
  ]);

  it("produces one link per edge with an id, from, to, and a path", () => {
    const links = route([{ id: "e1", from: "a", to: "b", kind: "calls" }], boxes);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ id: "e1", from: "a", to: "b", kind: "calls" });
    expect(links[0]!.path.length).toBeGreaterThanOrEqual(2);
  });

  it("bundles multiple edges between the same box pair into one link with a weight label", () => {
    const links = route(
      [
        { id: "e1", from: "a", to: "b", kind: "calls" },
        { id: "e2", from: "a", to: "b", kind: "calls" },
        { id: "e3", from: "a", to: "b", kind: "calls" },
      ],
      boxes,
    );
    expect(links).toHaveLength(1);
    expect(links[0]!.bundle).toEqual(["e1", "e2", "e3"]);
  });

  it("assigns distinct lanes to parallel edges that share a source but diverge, so they never share a y", () => {
    const links = route(
      [
        { id: "e1", from: "a", to: "b", kind: "calls" },
        { id: "e2", from: "a", to: "c", kind: "calls" },
      ],
      boxes,
    );
    const lanes = links.map((l) => l.lane);
    expect(new Set(lanes).size).toBe(lanes.length);
  });

  it("orders lanes by target x (left-to-right sweep)", () => {
    const links = route(
      [
        { id: "e_to_c", from: "a", to: "c", kind: "calls" },
        { id: "e_to_b", from: "a", to: "b", kind: "calls" },
      ],
      boxes,
    );
    const toB = links.find((l) => l.to === "b")!;
    const toC = links.find((l) => l.to === "c")!;
    expect(toB.lane).toBeLessThan(toC.lane);
  });

  it("skips edges referencing unknown boxes rather than throwing", () => {
    const links = route([{ id: "e1", from: "a", to: "missing", kind: "calls" }], boxes);
    expect(links).toHaveLength(0);
  });
});

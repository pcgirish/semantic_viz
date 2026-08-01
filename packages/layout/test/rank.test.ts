import { describe, expect, it } from "vitest";
import { rank } from "../src/rank.js";

describe("rank", () => {
  it("ranks a source above a sink it calls", () => {
    const ranks = rank(
      ["a", "b"],
      [{ from: "a", to: "b" }],
    );
    expect(ranks.get("a")).toBe(0);
    expect(ranks.get("b")).toBe(1);
  });

  it("uses longest path when multiple paths reach the same node", () => {
    // a -> b -> c, a -> c directly. c must rank below b (longest path), not just below a.
    const ranks = rank(
      ["a", "b", "c"],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "a", to: "c" },
      ],
    );
    expect(ranks.get("a")).toBe(0);
    expect(ranks.get("b")).toBe(1);
    expect(ranks.get("c")).toBe(2);
  });

  it("ranks disconnected nodes at 0", () => {
    const ranks = rank(["a", "b", "isolated"], [{ from: "a", to: "b" }]);
    expect(ranks.get("isolated")).toBe(0);
  });

  it("breaks cycles by ignoring back-edges rather than looping forever", () => {
    const ranks = rank(
      ["a", "b"],
      [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    );
    expect(ranks.get("a")).toBe(0);
    expect(ranks.get("b")).toBe(1);
  });

  it("ranks a diamond correctly", () => {
    const ranks = rank(
      ["a", "b", "c", "d"],
      [
        { from: "a", to: "b" },
        { from: "a", to: "c" },
        { from: "b", to: "d" },
        { from: "c", to: "d" },
      ],
    );
    expect(ranks.get("a")).toBe(0);
    expect(ranks.get("b")).toBe(1);
    expect(ranks.get("c")).toBe(1);
    expect(ranks.get("d")).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import { topoOrder } from "../src/topo-order.js";

describe("topoOrder", () => {
  it("orders a linear chain a -> b -> c so callees run before callers: c, b, a", () => {
    const ids = ["a", "b", "c"];
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ];

    expect(topoOrder(ids, edges)).toEqual(["c", "b", "a"]);
  });

  it("completes on a cycle a -> b -> a without looping forever, picking one entry per SCC", () => {
    const ids = ["a", "b"];
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
    ];

    const order = topoOrder(ids, edges);
    expect(order.sort()).toEqual(["a", "b"]);
  });

  it("keeps declaration order for units with no call edges between them", () => {
    const ids = ["x", "y", "z"];
    const order = topoOrder(ids, []);
    expect(order).toEqual(["x", "y", "z"]);
  });

  it("handles a diamond a -> b, a -> c, b -> d, c -> d — d must come before b, c, and a", () => {
    const ids = ["a", "b", "c", "d"];
    const edges = [
      { from: "a", to: "b" },
      { from: "a", to: "c" },
      { from: "b", to: "d" },
      { from: "c", to: "d" },
    ];

    const order = topoOrder(ids, edges);
    const idx = (id: string) => order.indexOf(id);
    expect(idx("d")).toBeLessThan(idx("b"));
    expect(idx("d")).toBeLessThan(idx("c"));
    expect(idx("b")).toBeLessThan(idx("a"));
    expect(idx("c")).toBeLessThan(idx("a"));
  });
});

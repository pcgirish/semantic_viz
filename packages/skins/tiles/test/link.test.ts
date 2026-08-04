import { describe, expect, it } from "vitest";
import { link } from "../src/link.js";
import type { SceneLink } from "@scv/layout";

function makeLink(overrides: Partial<SceneLink> & { id: string }): SceneLink {
  return {
    from: "a",
    to: "b",
    path: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
    lane: 0,
    bundle: [overrides.id],
    kind: "calls",
    state: "current",
    ...overrides,
  };
}

describe("link", () => {
  it("renders an SVG group wrapping a path through every path point", () => {
    const g = link(makeLink({ id: "e1", path: [{ x: 0, y: 0 }, { x: 50, y: 20 }, { x: 100, y: 100 }] }));
    expect(g.tagName.toLowerCase()).toBe("g");
    const path = g.querySelector("path")!;
    expect(path.dataset.from).toBe("a");
    expect(path.dataset.to).toBe("b");
  });

  it("is not marked faint by default (below density-gating threshold)", () => {
    const g = link(makeLink({ id: "e1" }));
    expect(g.querySelector("path")!.classList.contains("faint")).toBe(false);
  });

  it("is marked faint when the caller says the view is density-gated", () => {
    const g = link(makeLink({ id: "e1" }), { gated: true });
    expect(g.querySelector("path")!.classList.contains("faint")).toBe(true);
  });

  it("ungates a specific edge even under gating when it touches the focused unit", () => {
    const g = link(makeLink({ id: "e1", from: "a", to: "b" }), { gated: true, focusId: "a" });
    expect(g.querySelector("path")!.classList.contains("faint")).toBe(false);
  });

  it("carries the bundle size so the caller can render a weight label for bundle.length > 1", () => {
    const g = link(makeLink({ id: "e1", bundle: ["e1", "e2", "e3"] }));
    expect(g.querySelector("path")!.dataset.weight).toBe("3");
  });

  it("renders a midpoint label for a flowType-carrying link", () => {
    const g = link(makeLink({ id: "e1", flowType: "true", path: [{ x: 0, y: 0 }, { x: 100, y: 100 }] }));
    const label = g.querySelector(".lk-label")!;
    expect(label.textContent).toBe("yes");
  });

  it("renders no midpoint label when flowType is absent", () => {
    const g = link(makeLink({ id: "e1" }));
    expect(g.querySelector(".lk-label")).toBeNull();
  });

  it("labels a false-branch link no and a loop-back link with a loop icon", () => {
    const falseLink = link(makeLink({ id: "e1", flowType: "false" }));
    expect(falseLink.querySelector(".lk-label")!.textContent).toBe("no");
    const loopLink = link(makeLink({ id: "e2", flowType: "loop-back" }));
    expect(loopLink.querySelector(".lk-label")!.textContent).toBe("↺");
  });
});

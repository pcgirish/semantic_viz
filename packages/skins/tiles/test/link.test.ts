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
  it("renders an SVG path through every path point", () => {
    const el = link(makeLink({ id: "e1", path: [{ x: 0, y: 0 }, { x: 50, y: 20 }, { x: 100, y: 100 }] }));
    expect(el.tagName.toLowerCase()).toBe("path");
    expect(el.dataset.from).toBe("a");
    expect(el.dataset.to).toBe("b");
  });

  it("is not marked faint by default (below density-gating threshold)", () => {
    const el = link(makeLink({ id: "e1" }));
    expect(el.classList.contains("faint")).toBe(false);
  });

  it("is marked faint when the caller says the view is density-gated", () => {
    const el = link(makeLink({ id: "e1" }), { gated: true });
    expect(el.classList.contains("faint")).toBe(true);
  });

  it("ungates a specific edge even under gating when it touches the focused unit", () => {
    const el = link(makeLink({ id: "e1", from: "a", to: "b" }), { gated: true, focusId: "a" });
    expect(el.classList.contains("faint")).toBe(false);
  });

  it("carries the bundle size so the caller can render a weight label for bundle.length > 1", () => {
    const el = link(makeLink({ id: "e1", bundle: ["e1", "e2", "e3"] }));
    expect(el.dataset.weight).toBe("3");
  });
});

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { SceneRegion } from "@scv/layout";
import { region } from "../src/region.js";

function makeRegion(overrides: Partial<SceneRegion> & { id: string }): SceneRegion {
  return { name: overrides.id, x: 0, y: 0, w: 200, h: 150, ...overrides };
}

function box(r: SceneRegion, origin?: { x: number; y: number }): HTMLElement {
  const { container } = render(region(r, { origin }));
  return container.querySelector(".region") as HTMLElement;
}

describe("region", () => {
  it("renders a box sized to the region, positioned relative to the origin", () => {
    const el = box(makeRegion({ id: "api-surface", name: "api surface", x: 110, y: 220, w: 300, h: 200 }), { x: 10, y: 20 });
    expect(el.dataset.id).toBe("api-surface");
    expect(el.style.left).toBe("100px");
    expect(el.style.top).toBe("200px");
    expect(el.style.width).toBe("300px");
    expect(el.style.height).toBe("200px");
  });

  it("draws the box as a dashed rule, so it reads as a grouping and not a tile", () => {
    const el = box(makeRegion({ id: "api-surface" }));
    expect(el.style.border).toContain("dashed");
  });

  it("labels the region with its name, uppercased", () => {
    const el = box(makeRegion({ id: "api-surface", name: "api surface" }));
    expect(el.querySelector(".region-label")?.textContent).toBe("API SURFACE");
  });

  it("does not intercept pointer events — a region must never swallow a tile click", () => {
    const el = box(makeRegion({ id: "api-surface" }));
    expect(el.style.pointerEvents).toBe("none");
  });
});

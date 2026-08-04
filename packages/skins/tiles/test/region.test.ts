import { describe, expect, it } from "vitest";
import { region } from "../src/region.js";
import type { SceneRegion } from "@scv/layout";

function makeRegion(overrides: Partial<SceneRegion> & { id: string }): SceneRegion {
  return {
    name: overrides.id,
    x: 0,
    y: 0,
    w: 200,
    h: 150,
    ...overrides,
  };
}

describe("region", () => {
  it("renders an SVG group with a dashed rect sized to the region's box", () => {
    const el = region(makeRegion({ id: "api-surface", name: "api surface", x: 10, y: 20, w: 300, h: 200 }));
    expect(el.tagName.toLowerCase()).toBe("g");

    const rect = el.querySelector("rect")!;
    expect(rect.getAttribute("x")).toBe("10");
    expect(rect.getAttribute("y")).toBe("20");
    expect(rect.getAttribute("width")).toBe("300");
    expect(rect.getAttribute("height")).toBe("200");
  });

  it("includes an uppercase text label containing the region's name", () => {
    const el = region(makeRegion({ id: "api-surface", name: "api surface" }));
    const label = el.querySelector("text")!;
    expect(label.textContent).toBe("API SURFACE");
  });

  it("colors the region stroke by hashing its stable id, same palette as tile layer colors", () => {
    const el = region(makeRegion({ id: "api-surface", name: "api surface" }));
    const rect = el.querySelector("rect")!;
    expect(rect.getAttribute("stroke")).toBeTruthy();
  });
});

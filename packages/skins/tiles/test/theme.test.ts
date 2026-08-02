import { describe, expect, it } from "vitest";
import { hashLayerToColor, layerPalette } from "../src/theme.js";

describe("hashLayerToColor", () => {
  it("is deterministic: the same layer id always maps to the same color", () => {
    expect(hashLayerToColor("u:layer:abc123")).toBe(hashLayerToColor("u:layer:abc123"));
  });

  it("returns a color drawn from layerPalette", () => {
    expect(layerPalette).toContain(hashLayerToColor("u:layer:abc123"));
  });

  it("returns an empty string for an empty layer id", () => {
    expect(hashLayerToColor("")).toBe("");
  });

  it("distributes different ids across the palette (not all the same color)", () => {
    const ids = ["u:layer:a", "u:layer:b", "u:layer:c", "u:layer:d", "u:layer:e"];
    const colors = new Set(ids.map((id) => hashLayerToColor(id)));
    expect(colors.size).toBeGreaterThan(1);
  });
});

import { describe, expect, it } from "vitest";
import { tilesSkin } from "../src/index.js";

describe("tilesSkin", () => {
  it("is a fixed-camera 2D skin", () => {
    expect(tilesSkin.camera).toBe("fixed");
  });

  it("exposes node, link, and theme", () => {
    expect(typeof tilesSkin.node).toBe("function");
    expect(typeof tilesSkin.link).toBe("function");
    expect(tilesSkin.theme).toBeDefined();
  });

  it("navigate(focus) returns a pan/zoom camera move targeting the unit, not a 3D move", () => {
    const move = tilesSkin.navigate({ kind: "focus", unit: "u:a" });
    expect(move).toMatchObject({ kind: "pan-zoom", target: "u:a" });
  });

  it("navigate(drill) and navigate(ascend) both resolve to pan-zoom moves", () => {
    expect(tilesSkin.navigate({ kind: "drill", unit: "u:a" }).kind).toBe("pan-zoom");
    expect(tilesSkin.navigate({ kind: "ascend" }).kind).toBe("pan-zoom");
  });
});

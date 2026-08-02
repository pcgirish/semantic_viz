import { describe, expect, it } from "vitest";
import { tiles3dSkin } from "../src/index.js";

describe("tiles3dSkin", () => {
  it("is an orbit-camera 3D skin, not fixed", () => {
    expect(tiles3dSkin.camera).toBe("orbit");
  });

  it("exposes node, link, and theme", () => {
    expect(typeof tiles3dSkin.node).toBe("function");
    expect(typeof tiles3dSkin.link).toBe("function");
    expect(tiles3dSkin.theme).toBeDefined();
  });

  it("navigate(focus/drill) returns an orbit-target camera move, never a pan-zoom", () => {
    const move = tiles3dSkin.navigate({ kind: "focus", unit: "u:a" });
    expect(move).toMatchObject({ kind: "orbit-to", target: "u:a" });
  });

  it("navigate(trace) returns a flight path along the given units, for wayfinding", () => {
    const move = tiles3dSkin.navigate({ kind: "trace", path: ["u:a", "u:b"] });
    expect(move).toMatchObject({ kind: "fly-path", path: ["u:a", "u:b"] });
  });

  it("navigate(ascend) orbits out with no target (pulls back to the parent view)", () => {
    const move = tiles3dSkin.navigate({ kind: "ascend" });
    expect(move.kind).toBe("orbit-to");
    expect((move as { target?: string }).target).toBeUndefined();
  });
});

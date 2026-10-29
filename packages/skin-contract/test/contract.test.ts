import { describe, expect, it } from "vitest";
import { tilesSkin } from "@semviz/skin-tiles";
import { tiles3dSkin } from "@semviz/skin-tiles3d";
import type { CameraMove, Intent, Skin } from "../src/index.js";

/**
 * The contract is types-only, so its test is a conformance test: every shipped skin must
 * satisfy the one shared shape. This is what makes the seam real rather than declarative —
 * if a skin drifts, this fails to compile.
 */
const skins: Array<{ name: string; skin: Skin<unknown, unknown, unknown> }> = [
  { name: "tiles", skin: tilesSkin },
  { name: "tiles3d", skin: tiles3dSkin },
];

const intents: Intent[] = [
  { kind: "focus", unit: "u:a" },
  { kind: "drill", unit: "u:a" },
  { kind: "ascend" },
  { kind: "trace", path: ["u:a", "u:b"] },
];

const MOVE_KINDS = new Set<CameraMove["kind"]>(["pan-zoom", "orbit-to", "fly-path", "walk-to"]);
const CAMERA_MODELS = new Set(["fixed", "orbit", "walk", "fly"]);

describe.each(skins)("$name satisfies the shared skin contract", ({ skin }) => {
  it("exposes node, link, theme, camera, and navigate", () => {
    expect(typeof skin.node).toBe("function");
    expect(typeof skin.link).toBe("function");
    expect(typeof skin.navigate).toBe("function");
    expect(skin.theme).toBeDefined();
  });

  it("declares a camera model the host can dispatch on", () => {
    expect(CAMERA_MODELS.has(skin.camera)).toBe(true);
  });

  it("answers every Intent with a CameraMove from the shared union", () => {
    for (const intent of intents) {
      const move = skin.navigate(intent);
      expect(MOVE_KINDS.has(move.kind), `${intent.kind} -> ${move.kind}`).toBe(true);
    }
  });
});

describe("theme", () => {
  it("is the same shape across skins, so a host can read it without knowing the skin", () => {
    expect(Object.keys(tilesSkin.theme).sort()).toEqual(Object.keys(tiles3dSkin.theme).sort());
  });
});

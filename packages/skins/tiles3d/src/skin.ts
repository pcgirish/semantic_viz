import type { Object3D } from "three";
import type { SceneLink, SceneNode } from "@scv/layout";
import type { CameraMove, Intent, RenderContext, Skin, Theme } from "@scv/skin-contract";
import { node } from "./node.js";
import { link, type LinkOptions } from "./link.js";
import { defaultTheme } from "./theme.js";

// The contract now lives in @scv/skin-contract so every skin and host shares one shape
// (docs/serve.md#6 "Navigation belongs in the skin contract"). Re-exported here so existing
// importers of @scv/skin-tiles3d keep working.
export type { CameraMove, Intent, RenderContext, Theme };

/** tiles3d draws into a THREE scene graph; the paired host is Canvas3dHost. */
export type Tiles3dSkin = Skin<Object3D, Object3D, Object3D>;

/**
 * `tiles3d` — same scene, extruded prisms, orbit camera (docs/serve.md#6). Geometry is a
 * pure extrusion of the 2D layout (docs/serve.md#21) — never a separate 3D placement, so
 * this skin makes zero changes under `layout/`.
 */
export const tiles3dSkin: Tiles3dSkin = {
  node: (n: SceneNode, ctx?: RenderContext) => node(n, ctx),
  link: (l: SceneLink, options?: unknown) => link(l, options as LinkOptions | undefined),
  theme: defaultTheme,
  camera: "orbit",
  navigate(intent: Intent): CameraMove {
    switch (intent.kind) {
      case "focus":
      case "drill":
        return { kind: "orbit-to", target: intent.unit };
      case "ascend":
        return { kind: "orbit-to" };
      case "trace":
        return { kind: "fly-path", path: intent.path };
    }
  },
};

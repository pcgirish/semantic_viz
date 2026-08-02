import type { Object3D } from "three";
import type { SceneLink, SceneNode } from "@scv/layout";
import { node } from "./node.js";
import { link, type LinkOptions } from "./link.js";
import { defaultTheme, type Theme } from "./theme.js";

// docs/serve.md#6 "Navigation belongs in the skin contract".
export type Intent =
  | { kind: "focus"; unit: string }
  | { kind: "drill"; unit: string }
  | { kind: "ascend" }
  | { kind: "trace"; path: string[] };

export type CameraMove =
  | { kind: "orbit-to"; target?: string }
  | { kind: "fly-path"; path: string[] };

export type Skin = {
  node: (n: SceneNode) => Object3D;
  link: (l: SceneLink, options?: LinkOptions) => Object3D;
  theme: Theme;
  camera: "fixed" | "orbit" | "walk" | "fly";
  navigate: (intent: Intent) => CameraMove;
};

/**
 * `tiles3d` — same scene, extruded prisms, orbit camera (docs/serve.md#6). Geometry is a
 * pure extrusion of the 2D layout (docs/serve.md#21) — never a separate 3D placement, so
 * this skin makes zero changes under `layout/`.
 */
export const tiles3dSkin: Skin = {
  node,
  link,
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

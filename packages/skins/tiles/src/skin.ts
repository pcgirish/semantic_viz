import type { SceneLink, SceneNode, SceneRegion } from "@scv/layout";
import { node } from "./node.js";
import { link, type LinkOptions } from "./link.js";
import { region } from "./region.js";
import { defaultTheme, type Theme } from "./theme.js";

// docs/serve.md#6 "Navigation belongs in the skin contract".
export type Intent =
  | { kind: "focus"; unit: string }
  | { kind: "drill"; unit: string }
  | { kind: "ascend" }
  | { kind: "trace"; path: string[] };

export type CameraMove = { kind: "pan-zoom"; target?: string; path?: string[] };

export type Skin = {
  node: (n: SceneNode) => SVGGElement;
  link: (l: SceneLink, options?: LinkOptions) => SVGPathElement;
  region?: (r: SceneRegion) => SVGGElement;
  theme: Theme;
  camera: "fixed" | "orbit" | "walk" | "fly";
  navigate: (intent: Intent) => CameraMove;
};

/**
 * `tiles` — flat polygons, maximum legibility, the reference implementation (docs/serve.md#6).
 * Fixed 2D camera: navigation is always a pan/zoom, never a 3D camera move (that's tiles3d).
 */
export const tilesSkin: Skin = {
  node,
  link,
  region,
  theme: defaultTheme,
  camera: "fixed",
  navigate(intent: Intent): CameraMove {
    switch (intent.kind) {
      case "focus":
      case "drill":
        return { kind: "pan-zoom", target: intent.unit };
      case "ascend":
        return { kind: "pan-zoom" };
      case "trace":
        return { kind: "pan-zoom", path: intent.path };
    }
  },
};

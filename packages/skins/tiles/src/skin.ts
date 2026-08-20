import type { SceneLink, SceneNode, SceneRegion } from "@scv/layout";
import type { CameraMove, Intent, RenderContext, Skin, Theme } from "@scv/skin-contract";
import { node } from "./node.js";
import { link, type LinkOptions } from "./link.js";
import { region } from "./region.js";
import { defaultTheme } from "./theme.js";

// The contract now lives in @scv/skin-contract so every skin and host shares one shape
// (docs/serve.md#6 "Navigation belongs in the skin contract"). Re-exported here so existing
// importers of @scv/skin-tiles keep working.
export type { CameraMove, Intent, RenderContext, Theme };

/** tiles draws into SVG; the paired host is the React/DOM CanvasHost. */
export type TilesSkin = Skin<SVGGElement, SVGGElement, SVGGElement>;

/**
 * `tiles` — flat polygons, maximum legibility, the reference implementation (docs/serve.md#6).
 * Fixed 2D camera: navigation is always a pan/zoom, never a 3D camera move (that's tiles3d).
 */
export const tilesSkin: TilesSkin = {
  node: (n: SceneNode) => node(n),
  link: (l: SceneLink, options?: unknown) => link(l, options as LinkOptions | undefined),
  region: (r: SceneRegion) => region(r),
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

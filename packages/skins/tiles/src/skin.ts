import type { ReactElement } from "react";
import type { SceneLink, SceneNode, SceneRegion } from "@semviz/layout";
import type { CameraMove, Intent, RenderContext, Skin, Theme } from "@semviz/skin-contract";
import { node } from "./node.js";
import { link, type LinkOptions } from "./link.js";
import { region } from "./region.js";
import { defaultTheme } from "./theme.js";

// The contract now lives in @semviz/skin-contract so every skin and host shares one shape
// (docs/serve.md#6 "Navigation belongs in the skin contract"). Re-exported here so existing
// importers of @semviz/skin-tiles keep working.
export type { CameraMove, Intent, RenderContext, Theme };

/**
 * tiles draws React elements built from design-system components; the paired host is
 * CanvasHost, which places them and never restyles them. Links stay SVG — they are drawn
 * by the host's ConnectorLayer into one shared <svg>, not per link.
 */
export type TilesSkin = Skin<ReactElement, SVGGElement, ReactElement>;

/**
 * `tiles` — flat polygons, maximum legibility, the reference implementation (docs/serve.md#6).
 * Fixed 2D camera: navigation is always a pan/zoom, never a 3D camera move (that's tiles3d).
 */
export const tilesSkin: TilesSkin = {
  node: (n: SceneNode, ctx?: RenderContext) => node(n, ctx),
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

import type { Object3D } from "three";
import type { SceneLink, SceneNode } from "@scv/layout";
import type { CameraMove, Intent, RenderContext, Skin } from "@scv/skin-contract";
import { node as tiles3dNode, link as tiles3dLink, defaultTheme, type LinkOptions } from "@scv/skin-tiles3d";

export type CityscapeSkin = Skin<Object3D, Object3D, Object3D>;

/**
 * `cityscape` — the same extruded city as `tiles3d`, entered rather than observed
 * (docs/serve.md#6). The two skins differ in exactly one thing the contract can see, the
 * camera model, and that is the point: it is what proves the contract carries navigation
 * rather than just geometry.
 *
 * Geometry is deliberately `tiles3d`'s, not a second implementation. Footprint area is sloc,
 * sides are complexity, height is `depth` — encoding that belongs to the layout engine
 * (docs/serve.md#1), so a parallel extrusion here would only be a second place for those
 * readings to drift apart. What this skin adds is everything a walker needs and an orbiting
 * viewer does not: a floor (`ground.ts`) and a rank instrument (`minimap.ts`).
 */
export const cityscapeSkin: CityscapeSkin = {
  node: (n: SceneNode, ctx?: RenderContext) => tiles3dNode(n, ctx),
  link: (l: SceneLink, options?: unknown) => tiles3dLink(l, options as LinkOptions | undefined),
  theme: defaultTheme,
  camera: "walk",
  navigate(intent: Intent): CameraMove {
    switch (intent.kind) {
      case "focus":
      case "drill":
        // Walk, never cut. Travel being visible is the premise of the view: arriving
        // somewhere is what tells you where it sits relative to where you were.
        return { kind: "walk-to", target: intent.unit };
      case "ascend":
        return { kind: "walk-to" };
      case "trace":
        // A trace spans the graph. Walking one at eye level takes the overview away exactly
        // when the user asked to see a route, so travel lifts off (docs/serve.md#6 declares
        // both models for this skin).
        return { kind: "fly-path", path: intent.path };
    }
  },
};

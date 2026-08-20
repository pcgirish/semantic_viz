import type { SceneLink, SceneNode, SceneRegion } from "@scv/layout";

/**
 * The skin contract: the spec for turning a Scene into a drawing (docs/serve.md#1, #6).
 *
 * Layering, and what each side is forbidden from knowing:
 *   layout        -> produces the Scene. Knows nothing about renderers.
 *   design-system -> colours, shapes, connectors, texture. Skin-agnostic.
 *   skins/*       -> Scene -> drawable; declares its camera model and navigate().
 *   ui hosts      -> own the canvas, the render loop, input, and camera execution.
 *
 * A skin returns drawable objects and returns; it never owns a canvas. That is why a 3D
 * skin still needs a paired host: the contract makes the skin swappable, but a <div>
 * cannot render WebGL. Hence `TNode` is generic rather than a union — a union spanning
 * SVG and Object3D would let a 2D host be handed a THREE.Group it cannot mount.
 */

/** Theme is presentational only. A skin may reinterpret the theme freely, never the encoding (docs/serve.md#6). */
export type Theme = {
  ink: string;
  slate: string;
  hair: string;
  added: string;
  removed: string;
  modified: string;
  hi: string;
};

/** Delta state for one unit. Lives outside Scene because it is a comparison of two revs, not a layout fact. */
export type DeltaInfo = { status: string; amount: number; risk: number | null };

/**
 * What the app knows and the Scene cannot express. Delta mode is the reason this exists:
 * `SceneNode` alone cannot say "this unit changed by 0.4 since the parent rev".
 */
export type RenderContext = {
  delta?: DeltaInfo;
  /** Resolved layer hue (docs/serve.md#2 — hue encodes layer, categorical). */
  layerColor?: string;
  /** Currently focused/hovered unit, for dimming and occlusion decisions. */
  focusId?: string;
  /** True when density gating has dropped this element to a hairline (docs/serve.md#3). */
  gated?: boolean;
};

// docs/serve.md#6 "Navigation belongs in the skin contract".
export type Intent =
  | { kind: "focus"; unit: string }
  | { kind: "drill"; unit: string }
  | { kind: "ascend" }
  | { kind: "trace"; path: string[] };

/**
 * The application never sets a camera position. It emits an Intent and the skin decides
 * what that means; the host executes the resulting move (docs/serve.md#6).
 */
export type CameraMove =
  | { kind: "pan-zoom"; target?: string; path?: string[] }
  | { kind: "orbit-to"; target?: string }
  | { kind: "fly-path"; path: string[] }
  | { kind: "walk-to"; target?: string; path?: string[] };

export type CameraModel = "fixed" | "orbit" | "walk" | "fly";

/**
 * Generic over render output so each skin keeps its own element type end-to-end:
 * `Skin<ReactElement>` for tiles, `Skin<Object3D>` for tiles3d/cityscape.
 */
export type Skin<TNode, TLink = TNode, TRegion = TNode> = {
  node: (n: SceneNode, ctx?: RenderContext) => TNode;
  link: (l: SceneLink, options?: unknown) => TLink;
  region?: (r: SceneRegion) => TRegion;
  theme: Theme;
  camera: CameraModel;
  navigate: (intent: Intent) => CameraMove;
};

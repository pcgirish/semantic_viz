import type { Scene } from "@scv/layout";
import { bounds } from "./bounds.js";

/** Where the walker is standing and which way they face, in world coordinates. */
export type Viewer = {
  x: number;
  /** World z — the rank axis, the one that stops being visible at eye level. */
  z: number;
  /** Facing, in radians, measured the same way THREE measures rotation about Y. */
  heading: number;
};

export type MinimapSize = { width: number; height: number };

export type MinimapNode = {
  id: string;
  /** Map-space position, in the same pixel units as `MinimapSize`. */
  x: number;
  y: number;
  /** Half-extent on the map, for drawing the footprint rather than a dot. */
  r: number;
  layer?: string;
};

export type MinimapProjection = {
  nodes: MinimapNode[];
  viewer: { x: number; y: number; heading: number };
  /** World-to-map scale, so a caller can size strokes consistently with the footprints. */
  scale: number;
};

/**
 * Projects the city and the walker into a top-down map.
 *
 * This is the answer to Checkpoint 2's second question. Rank is the axis the whole layout is
 * built on, and it survives being looked *at* from orbit but not being stood *in*: the moment
 * the camera enters the scene, rank stops being something you see and becomes a direction you
 * walk. Nothing in the 3D view recovers it — hue encodes layer, an orthogonal fact, and height
 * encodes sloc. So the map is not an inset or a convenience; at street level it is the only
 * instrument that can say which way is up the dependency graph (docs/serve.md#189).
 *
 * Which is why the viewer's *heading* matters as much as their position. Knowing where you
 * stand on the map still leaves you unable to say whether walking forward takes you up-rank or
 * down; only the facing closes that gap.
 *
 * The projection deliberately reproduces the 2D view's own geometry — world x across, world z
 * down — rather than inventing a second picture of the codebase. A user who is already lost
 * should not also have to reconcile two different mental models.
 */
export function minimapProjection(scene: Scene, size: MinimapSize, viewer: Viewer): MinimapProjection {
  const b = bounds(scene);
  const span = Math.max(b.width, b.depth, 1);
  // One scale for both axes, so the map stays a faithful reduction instead of stretching the
  // city into a shape the street view will not match.
  const scale = Math.min(size.width, size.height) / span;

  // Centre the city in the map, so the same margin appears on the short axis. Offsets are
  // taken from the scene's own origin, which need not be zero.
  const offsetX = (size.width - b.width * scale) / 2 - b.minX * scale;
  const offsetY = (size.height - b.depth * scale) / 2 - b.minZ * scale;

  const toMap = (wx: number, wz: number) => ({
    x: offsetX + wx * scale,
    y: offsetY + wz * scale,
  });

  const nodes: MinimapNode[] = scene.nodes.map((n) => {
    const p = toMap(n.x + n.w / 2, n.y + n.h / 2);
    return {
      id: n.id,
      x: p.x,
      y: p.y,
      // Hue massing is the one wayfinding channel Checkpoint 2 found already working; carrying
      // layer onto the map is what lets the user match the district ahead of them to the map.
      r: Math.max((Math.min(n.w, n.h) / 2) * scale, 1),
      layer: n.layer,
    };
  });

  const v = toMap(viewer.x, viewer.z);
  return { nodes, viewer: { x: v.x, y: v.y, heading: viewer.heading }, scale };
}

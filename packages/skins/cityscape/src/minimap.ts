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
  const city = bounds(scene);

  // The map covers the city *and* the walker, never the city alone. The street camera stands
  // outside the near edge by a standoff derived from the city's own width, so an extent taken
  // from the buildings alone puts the marker outside its own box — clipped, and gone at
  // exactly the moment the walk begins. A map that can lose its "you are here" is not a map.
  const minX = Math.min(city.minX, viewer.x);
  const maxX = Math.max(city.minX + city.width, viewer.x);
  const minZ = Math.min(city.minZ, viewer.z);
  const maxZ = Math.max(city.minZ + city.depth, viewer.z);
  const width = maxX - minX;
  const depth = maxZ - minZ;

  const span = Math.max(width, depth, 1);
  // One scale for both axes, so the map stays a faithful reduction instead of stretching the
  // city into a shape the street view will not match.
  const scale = Math.min(size.width, size.height) / span;

  // Centre the covered extent in the map, so the same margin appears on the short axis.
  // Offsets are taken from the extent's own origin, which need not be zero.
  const offsetX = (size.width - width * scale) / 2 - minX * scale;
  const offsetY = (size.height - depth * scale) / 2 - minZ * scale;

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

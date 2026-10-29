import type { Scene } from "@semviz/layout";

/** Ground-plane extent of a scene, in world units: x across, z (the layout's y) into rank. */
export type Bounds = { minX: number; minZ: number; width: number; depth: number; cx: number; cz: number };

/**
 * Bounding box of a scene's nodes.
 *
 * `Scene` carries no width or height of its own — the extent is a property of where the
 * layout engine put the nodes, and every consumer derives it the same way (`sceneBounds` in
 * the 2D host does exactly this). Deriving it here rather than reading a field is what keeps
 * the two views agreeing about how big the city is.
 */
export function bounds(scene: Scene): Bounds {
  if (scene.nodes.length === 0) {
    return { minX: 0, minZ: 0, width: 1, depth: 1, cx: 0, cz: 0 };
  }
  const minX = Math.min(...scene.nodes.map((n) => n.x));
  const maxX = Math.max(...scene.nodes.map((n) => n.x + n.w));
  const minZ = Math.min(...scene.nodes.map((n) => n.y));
  const maxZ = Math.max(...scene.nodes.map((n) => n.y + n.h));
  return {
    minX,
    minZ,
    width: maxX - minX,
    depth: maxZ - minZ,
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
  };
}

import * as THREE from "three";
import type { Scene } from "@scv/layout";
import { bounds } from "./bounds.js";

/**
 * World size of one grid cell, matching `--grid-cell: 32px` in
 * design-system/tokens/geometry-3d.css — the same cell the 2D canvas draws, so the floor a
 * walker crosses and the grid behind the tiles are the same measure.
 */
const GRID_CELL = 32;

/** `--grid-line` and `--grid-line-major` from the same token file, as opaque equivalents. */
const GRID_LINE = 0x2c3a45;
const GRID_LINE_MAJOR = 0x3d515f;

/** `--face-neutral`'s dark end: the floor is the darkest surface, so facades read against it. */
const FLOOR_COLOR = 0x0e151d;

/**
 * How far past the city the floor runs, as a multiple of its longest span. The host fogs the
 * scene out well before this, so the effect is a floor that fades rather than one that ends.
 */
const FLOOR_SPAN_FACTOR = 6;

/**
 * Upper bound on grid divisions. Cells are a fixed world size, so on a large repo an honest
 * cell count would allocate a line buffer big enough to stall the first frame; past this the
 * grid coarsens instead of densifying. It is a texture for judging movement, not a ruler.
 */
const MAX_DIVISIONS = 240;

/**
 * Sits the city on a floor. `tiles3d` needs none — from orbit you look down at rooftops and
 * never see what is or is not underneath them. At eye level its absence is the first thing
 * you notice: buildings hanging in black, with nothing joining them and no sense of standing
 * anywhere.
 *
 * The grid is not decoration either. On a featureless plane walking forward looks identical
 * to standing still, because nothing in view changes; the grid is what makes motion legible.
 */
export function ground(scene: Scene): THREE.Group {
  const g = new THREE.Group();
  g.name = "ground-group";

  const b = bounds(scene);
  const span = Math.max(b.width, b.depth, GRID_CELL);
  const size = span * FLOOR_SPAN_FACTOR;
  const { cx, cz } = b;

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ color: FLOOR_COLOR, roughness: 1, metalness: 0 }),
  );
  plane.name = "ground";
  plane.rotation.x = -Math.PI / 2;
  // A hair below zero: buildings sit *on* the floor, and coplanar surfaces z-fight.
  plane.position.set(cx, -0.5, cz);
  g.add(plane);

  const divisions = Math.min(Math.max(Math.round(size / GRID_CELL), 1), MAX_DIVISIONS);
  const grid = new THREE.GridHelper(size, divisions, GRID_LINE_MAJOR, GRID_LINE);
  grid.name = "grid";
  grid.position.set(cx, 0, cz);
  g.add(grid);

  return g;
}

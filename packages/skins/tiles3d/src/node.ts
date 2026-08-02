import * as THREE from "three";
import type { SceneNode } from "@scv/layout";

const MIN_HEIGHT = 4;
const HEIGHT_PER_SLOC = 0.6;
const BEACON_HEIGHT = 40;

/** Height (extrude depth / cylinder height) reuses sloc — same channel as the 2D tile's area (docs/serve.md#38, "Extrusion depth"). */
function heightFor(sloc: number): number {
  return MIN_HEIGHT + sloc * HEIGHT_PER_SLOC;
}

/** Footprint polygon for an n-gon centred at the origin, matching the 2D skin's `ngon` reading (sides = complexity). */
function ngonShape(r: number, sides: number): THREE.Shape {
  const shape = new THREE.Shape();
  const rot = -Math.PI / 2;
  for (let i = 0; i <= sides; i++) {
    const a = rot + (i / sides) * 2 * Math.PI;
    const x = r * Math.cos(a);
    const y = r * Math.sin(a);
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  return shape;
}

/**
 * Extrudes one SceneNode into a prism (or cylinder for the 13+ bucket, sides=0) whose
 * footprint keeps the tile's complexity reading and whose height keeps sloc — geometry
 * only, same encoding as `tiles` (docs/serve.md#6, "same scene, extruded prisms").
 */
function body(n: SceneNode): THREE.Mesh {
  const height = heightFor(n.sloc);
  const r = Math.min(n.w, n.h) / 2;

  let geometry: THREE.BufferGeometry;
  if (n.sides === 0) {
    geometry = new THREE.CylinderGeometry(r, r, height, 24);
    geometry.translate(0, height / 2, 0);
  } else {
    const shape = ngonShape(r, n.sides);
    geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
    geometry.rotateX(-Math.PI / 2);
  }

  const material = new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "body";
  return mesh;
}

/** A beacon above the roofline for high-risk units — the thing you most need to see cannot hide behind a taller neighbour (docs/serve.md#182). */
function beacon(n: SceneNode): THREE.Mesh {
  const height = heightFor(n.sloc);
  const geometry = new THREE.ConeGeometry(4, BEACON_HEIGHT, 8);
  geometry.translate(0, height + BEACON_HEIGHT / 2, 0);
  const material = new THREE.MeshBasicMaterial({ color: 0xd64545 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "beacon";
  return mesh;
}

/**
 * Renders one Scene node as a THREE.Group on the ground plane: `x,y` maps to the plane,
 * `depth` is left for the caller to apply as world Y (docs/serve.md#21, "A 3D skin maps
 * the same x,y to a plane and extrudes by depth").
 */
export function node(n: SceneNode): THREE.Group {
  const g = new THREE.Group();
  g.name = n.id;
  g.position.set(n.x + n.w / 2, 0, n.y + n.h / 2);

  g.add(body(n));
  if (n.ring) g.add(beacon(n));

  return g;
}

import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { SceneNode } from "@scv/layout";
import type { RenderContext } from "@scv/skin-contract";

const BEACON_HEIGHT = 40;
const GATED_OPACITY = 0.18;

/** Facade for a unit whose layer is unknown — `--face-neutral` from design-system/tokens/geometry-3d.css. */
const NEUTRAL_FACE = "#6b7280";

/**
 * Delta as an emissive glow. A facade already spends its colour on layer hue, so delta
 * cannot repaint it without destroying the hue channel; light added *on top* is the one
 * treatment that reads at distance and still leaves the building its own colour
 * (docs/serve.md#2 — added/removed/modified each get a distinct treatment).
 */
const DELTA_GLOW: Record<string, string> = {
  added: "#1f9d55",
  removed: "#d64545",
  modified: "#f2a93b",
  risk_changed: "#f2a93b",
  rollup: "#f2a93b",
};

/**
 * Footprint polygon for an n-gon centred at the origin, matching the 2D skin's `ngon`
 * reading (sides = complexity).
 *
 * `r` is the tile's half-width, and a polygon drawn on that as its *circumradius* only
 * covers the tile at high side counts — a triangle covers a quarter of it, so a
 * low-complexity unit reads as a spike rather than a building. Scaling by the ratio of
 * circumradius to inradius makes every polygon span the tile regardless of side count, so
 * footprint area keeps meaning sloc the way `serve.md#2` says it does.
 */
function ngonShape(halfWidth: number, sides: number): THREE.Shape {
  const r = halfWidth / Math.cos(Math.PI / sides);
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
 * Facade material: layer hue is the colour (docs/serve.md#2), delta is a glow on top, and
 * density gating drops a non-focused building translucent so the focused one stays visible
 * through the crowd (docs/serve.md#3).
 */
function facade(n: SceneNode, ctx: RenderContext): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(ctx.layerColor || NEUTRAL_FACE),
    roughness: 0.75,
    metalness: 0.05,
  });

  const delta = ctx.delta;
  const glow = delta ? DELTA_GLOW[delta.status] : undefined;
  if (delta && glow) {
    material.emissive = new THREE.Color(glow);
    // Added and removed are binary facts and glow at full strength. The graded statuses
    // scale with `amount`, so the glow reads as magnitude the way 2D fill saturation does.
    const graded = delta.status !== "added" && delta.status !== "removed";
    material.emissiveIntensity = graded ? 0.15 + delta.amount * 0.85 : 1;
  }

  const faint = Boolean(ctx.gated) && ctx.focusId !== n.id;
  if (faint) {
    material.transparent = true;
    material.opacity = GATED_OPACITY;
  }

  return material;
}

/**
 * Extrudes one SceneNode into a prism (or cylinder for the 13+ bucket, sides=0) whose
 * footprint keeps the tile's complexity reading and whose height is `n.depth` — the
 * extrusion channel the layout engine populates from sloc (docs/serve.md#2). Height is read,
 * never recomputed: the encoding lives in layout, not in a skin (docs/serve.md#1).
 */
function body(n: SceneNode, ctx: RenderContext): THREE.Mesh {
  const height = n.depth;
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

  const mesh = new THREE.Mesh(geometry, facade(n, ctx));
  mesh.name = "body";
  return mesh;
}

/** A beacon above the roofline for high-risk units — the thing you most need to see cannot hide behind a taller neighbour (docs/serve.md#182). */
function beacon(n: SceneNode): THREE.Mesh {
  const geometry = new THREE.ConeGeometry(4, BEACON_HEIGHT, 8);
  geometry.translate(0, n.depth + BEACON_HEIGHT / 2, 0);
  const material = new THREE.MeshBasicMaterial({ color: 0xd64545 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "beacon";
  return mesh;
}

/**
 * The unit's name, hovering just above its roof. Rendered as real DOM by the host's
 * CSS2DRenderer, so labels inherit design-system fonts and stay crisp at any distance
 * instead of blurring like a texture would (docs/serve.md#6).
 */
function label(n: SceneNode): CSS2DObject {
  const el = document.createElement("div");
  el.className = "scene3d-label";
  el.textContent = n.name;
  const obj = new CSS2DObject(el);
  obj.name = "label";
  obj.position.set(0, n.depth + 8, 0);
  return obj;
}

/**
 * Renders one Scene node as a THREE.Group on the ground plane: `x,y` maps to the plane and
 * `depth` becomes world Y (docs/serve.md#21, "A 3D skin maps the same x,y to a plane and
 * extrudes by depth"). `userData.sceneNodeId` is set on the group, not the meshes, so a
 * raycast hit anywhere on a building resolves to its unit.
 */
export function node(n: SceneNode, ctx: RenderContext = {}): THREE.Group {
  const g = new THREE.Group();
  g.name = n.id;
  g.userData.sceneNodeId = n.id;
  g.position.set(n.x + n.w / 2, 0, n.y + n.h / 2);

  g.add(body(n, ctx));
  if (n.ring) g.add(beacon(n));
  if (n.name) g.add(label(n));

  return g;
}

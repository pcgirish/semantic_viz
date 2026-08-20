import * as THREE from "three";
import type { Scene } from "@scv/layout";
import { codedreamLayerPalette, hashLayerToColor } from "@scv/skin-tiles";
import { tiles3dSkin } from "@scv/skin-tiles3d";
import type { DeltaInfo } from "@scv/skin-contract";

/** Above this ratio the scene is dense enough that background edges fade (docs/serve.md#3). */
const GATE_RATIO = 1.6;

export type SceneGraphOptions = {
  /** Present only in delta mode — the same map CanvasHost takes (docs/serve.md#2). */
  deltaByUnit?: Map<string, DeltaInfo>;
};

/**
 * Builds the THREE object graph for one Scene by asking the skin to draw each node and
 * link. The host owns the canvas and the loop; the skin owns what things look like — so
 * everything here is scene bookkeeping (hue lookup, gating, delta plumbing) and never
 * geometry or colour of its own (docs/serve.md#6).
 */
export function buildSceneGraph(scene: Scene, options: SceneGraphOptions): THREE.Group {
  const root = new THREE.Group();
  root.name = "scene";

  const gated = scene.links.length > scene.nodes.length * GATE_RATIO;

  for (const l of scene.links) {
    const line = tiles3dSkin.link(l, { gated }) as THREE.Object3D;
    line.userData.linkEnds = [l.from, l.to];
    root.add(line);
  }

  for (const n of scene.nodes) {
    // serve.md#2: hue encodes layer (categorical), matching the 2D tiles exactly — the
    // same hashLayerToColor over the same palette, so a unit keeps its colour across skins.
    const layerColor = n.layer ? hashLayerToColor(n.layer, codedreamLayerPalette) : undefined;
    root.add(
      tiles3dSkin.node(n, {
        layerColor,
        delta: options.deltaByUnit?.get(n.id),
        gated,
      }) as THREE.Object3D,
    );
  }

  return root;
}

/** Opacity for a building that is not the focused one while something is focused. */
const UNFOCUSED_OPACITY = 0.35;

/** Opacity for an edge that does not touch the focused unit. */
const UNFOCUSED_EDGE_OPACITY = 0.08;

/**
 * Dims everything except the focused building and the edges touching it, in place.
 *
 * Focus changes on every click, so doing this by rebuilding the graph would dispose and
 * reallocate every geometry and material in the city on the most common interaction there
 * is; mutating the existing materials keeps a click to a property write.
 */
export function applyFocus(root: THREE.Group, focusId: string | null): void {
  for (const child of root.children) {
    const id = child.userData.sceneNodeId;
    if (typeof id !== "string") continue;
    const body = child.getObjectByName("body") as THREE.Mesh | undefined;
    const material = body?.material as THREE.MeshStandardMaterial | undefined;
    if (!material) continue;
    const faded = focusId !== null && id !== focusId;
    material.transparent = faded;
    material.opacity = faded ? UNFOCUSED_OPACITY : 1;
  }

  // Edges touching the focused unit stay at full strength — that trace is the reason to
  // dim anything at all (docs/serve.md#5).
  for (const child of root.children) {
    const ends = child.userData.linkEnds as [string, string] | undefined;
    const material = (child as THREE.Line).material as THREE.LineBasicMaterial | undefined;
    if (!ends || !material) continue;
    const faded = focusId !== null && !ends.includes(focusId);
    material.transparent = true;
    material.opacity = faded ? UNFOCUSED_EDGE_OPACITY : 1;
  }
}

/**
 * Releases every GPU resource the graph holds and empties it. Called on unmount *and*
 * before each rebuild: WebGL geometries and materials are not garbage-collected with their
 * JS wrappers, so skipping this leaks VRAM on every scene change and eventually exhausts
 * the browser's ~16 live-context budget when skins are toggled repeatedly.
 */
export function disposeGraph(root: THREE.Group): void {
  root.traverse((o) => {
    const m = o as Partial<THREE.Mesh>;
    m.geometry?.dispose();
    const material = m.material;
    if (Array.isArray(material)) for (const one of material) one.dispose();
    else material?.dispose();
  });
  root.clear();
}

/**
 * Walks up from a raycast hit to the building that owns it. `sceneNodeId` is tagged on the
 * group rather than each mesh, so clicking a roof, a wall, or a risk beacon all resolve to
 * the same unit.
 */
export function unitAt(hit: THREE.Object3D): string | null {
  let o: THREE.Object3D | null = hit;
  while (o) {
    const id = o.userData.sceneNodeId;
    if (typeof id === "string") return id;
    o = o.parent;
  }
  return null;
}

/** Eye height for the street camera, in scene units — below the rooflines, so buildings tower. */
const EYE_HEIGHT = 18;

export type CameraFraming = { position: THREE.Vector3; target: THREE.Vector3 };

/** Which way the camera looks at the city: down at it, or from inside it (docs/serve.md#6). */
export type ViewMode = "orbit" | "street";

/**
 * Where to put the camera for a scene. Orbit pulls back far enough to hold the whole city
 * in frame; street drops to eye height at the near edge, looking down the long axis — the
 * "walking in the codebase" reading, where rank becomes a direction you travel rather than
 * an axis you see at a glance.
 */
export function frameScene(scene: Scene, mode: ViewMode): CameraFraming {
  const box = footprint(scene);
  const target = new THREE.Vector3(box.cx, 0, box.cz);

  if (mode === "street") {
    // Stand at the near edge on the scene's long axis, eye-height, facing the centre.
    return {
      position: new THREE.Vector3(box.cx, EYE_HEIGHT, box.cz + box.depth / 2),
      target: new THREE.Vector3(box.cx, EYE_HEIGHT, box.cz),
    };
  }

  // Far enough back that the wider of the two spans fits the frame, and high enough that
  // rank (the z axis) still reads as depth rather than collapsing edge-on.
  const span = Math.max(box.width, box.depth, 1);
  return { position: new THREE.Vector3(box.cx, span * 0.6, box.cz + span * 0.9), target };
}

/** Ground-plane extent of the city: the same bounds the 2D view pans over, in x/z. */
function footprint(scene: Scene): { cx: number; cz: number; width: number; depth: number } {
  if (scene.nodes.length === 0) return { cx: 0, cz: 0, width: 1, depth: 1 };
  const minX = Math.min(...scene.nodes.map((n) => n.x));
  const maxX = Math.max(...scene.nodes.map((n) => n.x + n.w));
  const minZ = Math.min(...scene.nodes.map((n) => n.y));
  const maxZ = Math.max(...scene.nodes.map((n) => n.y + n.h));
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, width: maxX - minX, depth: maxZ - minZ };
}

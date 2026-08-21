import * as THREE from "three";
import type { Scene } from "@scv/layout";
import { codedreamLayerPalette, hashLayerToColor } from "@scv/skin-tiles";
import { tiles3dSkin } from "@scv/skin-tiles3d";
import { cityscapeSkin, ground } from "@scv/skin-cityscape";
import type { DeltaInfo, Skin } from "@scv/skin-contract";
import type { ViewMode } from "./store.js";

/** Which 3D skin the host is drawing. Both draw into the same scene graph (docs/serve.md#6). */
export type Skin3dName = "tiles3d" | "cityscape";

type Skin3d = Skin<THREE.Object3D, THREE.Object3D, THREE.Object3D>;

/**
 * The host resolves a skin by name rather than importing one. That indirection is the whole
 * point of the contract: the host knows it is handed something that can draw a node and
 * declares a camera model, and nothing else about it (docs/serve.md#6).
 */
const SKINS: Record<Skin3dName, Skin3d> = {
  tiles3d: tiles3dSkin,
  cityscape: cityscapeSkin,
};

export function skin3d(name: Skin3dName): Skin3d {
  return SKINS[name];
}

/** Above this ratio the scene is dense enough that background edges fade (docs/serve.md#3). */
const GATE_RATIO = 1.6;

export type SceneGraphOptions = {
  /** Present only in delta mode — the same map CanvasHost takes (docs/serve.md#2). */
  deltaByUnit?: Map<string, DeltaInfo>;
  /** Which skin draws the buildings. Defaults to the orbit skin. */
  skin?: Skin3dName;
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

  const name = options.skin ?? "tiles3d";
  const skin = skin3d(name);
  const gated = scene.links.length > scene.nodes.length * GATE_RATIO;

  // A walkable skin needs something underfoot; an orbiting one is looking down at rooftops
  // and never sees whether there is a floor. Asking the skin for it rather than drawing one
  // here keeps the host free of geometry.
  if (name === "cityscape") root.add(ground(scene));

  for (const l of scene.links) {
    const line = skin.link(l, { gated }) as THREE.Object3D;
    line.userData.linkEnds = [l.from, l.to];
    root.add(line);
  }

  for (const n of scene.nodes) {
    // serve.md#2: hue encodes layer (categorical), matching the 2D tiles exactly — the
    // same hashLayerToColor over the same palette, so a unit keeps its colour across skins.
    const layerColor = n.layer ? hashLayerToColor(n.layer, codedreamLayerPalette) : undefined;
    root.add(
      skin.node(n, {
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
  let focused: THREE.Object3D | null = null;

  for (const child of root.children) {
    const id = child.userData.sceneNodeId;
    if (typeof id !== "string") continue;
    const body = child.getObjectByName("body") as THREE.Mesh | undefined;
    const material = body?.material as THREE.MeshStandardMaterial | undefined;
    if (!material) continue;
    const faded = focusId !== null && id !== focusId;
    material.transparent = faded;
    material.opacity = faded ? UNFOCUSED_OPACITY : 1;
    // Opacity alone does not stop a dimmed building occluding what is behind it: a
    // transparent mesh still writes depth by default, so a faded facade in front of the
    // focused one punches a hole showing the background rather than the building. Dropping
    // depth writes on faded bodies is what makes focus actually see-through
    // (docs/serve.md#187-192). The focused body keeps writing, or it renders inside-out.
    material.depthWrite = !faded;
    if (id === focusId) focused = child;
  }

  // Draw the focused building last. Transparent meshes are painted after opaque ones and
  // blended in traversal order, so without this a faded neighbour later in the list paints
  // over the solid focused building.
  if (focused) {
    root.remove(focused);
    root.add(focused);
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

    // Labels are DOM, not GPU state, and nothing above frees them. CSS2DRenderer only
    // detaches an element when its object is removed from a scene it is rendering, which
    // never happens for these nested children — so without this, every level you drill
    // through leaves its labels floating over the level you drilled into.
    const el = (o as unknown as { element?: HTMLElement }).element;
    el?.remove();
  });
  root.clear();
}

/**
 * Tears down a renderer for good, on unmount or a skin switch.
 *
 * `dispose()` alone is not enough: it frees the objects the renderer allocated but leaves the
 * WebGL context itself alive, and browsers cap how many may exist at once (~16). Measured
 * against `fixtures/orderly`, 30 toggles of the 2D/3D switch created 30 contexts and the
 * browser started evicting them — "Too many active WebGL contexts" — from the 17th on.
 * `forceContextLoss()` hands the context back explicitly so eviction never has to.
 */
export function disposeRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.dispose();
  renderer.forceContextLoss();
  renderer.domElement.remove();
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

/**
 * How far outside the city the street camera stands, as a fraction of the footprint's depth,
 * when ground extent along the rank axis is the binding constraint.
 * The near edge is where the outermost building is, so framing exactly on it puts the camera
 * inside a facade and the first frame is a wall of flat colour. Backing off by a margin means
 * you always start on the approach, looking down the rank axis at the city ahead of you.
 */
const STREET_STANDOFF = 0.15;

/**
 * Vertical field of view for the 3D camera, in degrees. Exported because the street framing
 * is computed from it, so the host must construct its camera with this same value or the
 * "fits the frame" guarantee below is quietly false.
 */
export const FOV_DEG = 60;

/**
 * Slack between the city and the frame edge, so the widest or tallest thing in view has air
 * around it instead of running off the sides.
 */
const FRAME_MARGIN = 1.25;

export type CameraFraming = { position: THREE.Vector3; target: THREE.Vector3 };

/** Which way the camera looks at the city — owned by the store, since the controls legend
 * outside the canvas reads it too. Re-exported here for the framing code that consumes it. */
export type { ViewMode } from "./store.js";

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
    // Stand at the near edge on the scene's long axis, eye-height, facing the centre, far
    // enough back that the city fits the frame. All three dimensions can be the binding one
    // and each fails differently, so the standoff is the largest of the three:
    //
    //   - ground depth: too close and you spawn inside the near row of facades;
    //   - height: too close and two towers become an alley with no city behind them;
    //   - width: too close and a single wide facade overflows the viewport as flat colour.
    //
    // Width is the one every *drilled* level needs, because those are a single rank row —
    // wide, shallow, and often wider than they are tall, so depth and height both under-read.
    const tallest = Math.max(...scene.nodes.map((n) => n.depth), 0);
    const halfFov = Math.tan((FOV_DEG * Math.PI) / 360);
    const standoff = Math.max(
      box.depth * (0.5 + STREET_STANDOFF),
      (tallest * FRAME_MARGIN) / halfFov,
      (box.width * FRAME_MARGIN) / halfFov,
    );
    return {
      position: new THREE.Vector3(box.cx, EYE_HEIGHT, box.cz + standoff),
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

/**
 * How far a label stays readable, in scene units. Buildings are ~96 wide, so this is roughly
 * a dozen of them — far enough that the block you are walking toward is named before you
 * reach it, near enough that the back of the city stops writing over the front of it.
 */
export const LABEL_MAX_DISTANCE = 1200;

/**
 * Half-size of the screen-space box a label is assumed to occupy, in normalised device units.
 * CSS2D labels are DOM whose real width depends on the text, but measuring every one per frame
 * would cost a layout pass per building; a fixed box is the cheap approximation, and erring
 * generous is the safe direction — a label wrongly dropped is recoverable by walking closer,
 * a label wrongly kept is the overlap this exists to prevent.
 */
const LABEL_HALF_NDC = { x: 0.11, y: 0.035 };

/**
 * Hides labels that cannot be read: too far away, or overlapping a nearer one.
 *
 * Checkpoint 2 confirmed the plan's "label legibility at distance" risk, and then the browser
 * showed that distance was only half of it. `scripts`, `migrations_group` and `src_db` collided
 * while all three were *near* the camera — they sit side by side in one rank row, so from the
 * street their names project into the same pixels however close you stand. Distance culling
 * cannot fix a failure that happens in screen space, so this does both: drop what is too far to
 * read, then drop what would be drawn on top of something nearer.
 *
 * Nearest wins, because that is the building you are walking toward and the one whose name you
 * are most likely to want.
 *
 * Called every frame from the render loop, so it stays cheap: projection into NDC and a box
 * test against the labels already kept. At 105 units the pairwise scan is nothing; if a repo
 * ever makes it matter, this is the place to put a grid.
 */
export function cullLabels(root: THREE.Group, camera: THREE.Camera): void {
  const eye = camera.position;

  const candidates: { label: THREE.Object3D; ndc: THREE.Vector3; distance: number }[] = [];
  for (const child of root.children) {
    if (typeof child.userData.sceneNodeId !== "string") continue;
    const label = child.getObjectByName("label");
    if (!label) continue;

    const distance = eye.distanceTo(child.position);
    if (distance > LABEL_MAX_DISTANCE) {
      label.visible = false;
      continue;
    }

    const ndc = label.getWorldPosition(new THREE.Vector3()).project(camera);
    // Behind the camera: `project` mirrors those to the front of the frustum, so without this
    // a building at your back can suppress the label of one ahead of you.
    if (ndc.z > 1) {
      label.visible = false;
      continue;
    }
    candidates.push({ label, ndc, distance });
  }

  candidates.sort((a, b) => a.distance - b.distance);

  const kept: THREE.Vector3[] = [];
  for (const c of candidates) {
    const collides = kept.some(
      (k) => Math.abs(k.x - c.ndc.x) < LABEL_HALF_NDC.x * 2 && Math.abs(k.y - c.ndc.y) < LABEL_HALF_NDC.y * 2,
    );
    c.label.visible = !collides;
    if (!collides) kept.push(c.ndc);
  }
}

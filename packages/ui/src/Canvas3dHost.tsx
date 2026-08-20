import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { Edge, Unit } from "@scv/schema";
import { buildScene, type Scene } from "@scv/layout";
import { useAppStore } from "./store.js";
import { applyFocus, buildSceneGraph, cullLabels, disposeGraph, disposeRenderer, frameScene, FOV_DEG, skin3d, unitAt, type Skin3dName, type ViewMode } from "./scene3d.js";
import type { TileDeltaInfo } from "./CanvasHost.js";
import { Minimap } from "./Minimap.js";
import { flyControls, orbitControls, walkControls, type Controls3d } from "./controls3d.js";
import type { Viewer } from "@scv/skin-cityscape";

export type Canvas3dHostProps = {
  units: Unit[];
  edges: Edge[];
  /** Present only in delta mode (docs/serve.md#2). */
  deltaByUnit?: Map<string, TileDeltaInfo>;
  /** Which 3D skin to draw. Defaults to the orbit skin. */
  skin?: Skin3dName;
};

/** How often the minimap re-reads the camera, in frames. 60fps / 6 = 10Hz — smooth enough to
 * track a walk, infrequent enough that it never costs a frame. */
const MINIMAP_EVERY = 6;

/** Matches --light-key: 145deg in design-system/tokens/geometry-3d.css, so 2D and 3D share one light. */
const KEY_LIGHT_DEG = 145;

const DRAG_THRESHOLD = 3;

/**
 * WebGL host for the 3D skins. It owns exactly what a skin cannot: the canvas, the render
 * loop, the camera, and hit-testing (docs/serve.md#6 — "'3D is just a skin' holds for
 * geometry and breaks for navigation"). The scene graph itself comes from the skin via
 * `buildSceneGraph`, so this file contains no geometry and no colour.
 *
 * Click selects and double-click drills, the same verbs as the 2D CanvasHost — a raycast
 * resolves the hit back to a unit id through `userData.sceneNodeId`.
 */
export function Canvas3dHost({ units, edges, deltaByUnit, skin = "tiles3d" }: Canvas3dHostProps): JSX.Element {
  const select = useAppStore((s) => s.select);
  const drill = useAppStore((s) => s.drill);
  const ascend = useAppStore((s) => s.ascend);
  const selection = useAppStore((s) => s.selection);
  const focus = useAppStore((s) => s.focus);
  // cityscape is always inside the city; what switches is how you travel through it. So the
  // walkable skin starts at street level, where the orbit skin starts above.
  const walkable = skin3d(skin).camera !== "orbit";
  // Both skins start in "orbit". For tiles3d that is the literal orbit camera; for cityscape
  // it is the fly camera framed on the whole city. Either way the user arrives able to see the
  // rank axis, and walks only once they have chosen somewhere to walk to.
  const [view, setView] = useState<ViewMode>("orbit");

  // Mirrors the camera into React state for the minimap. Kept out of the rAF loop's own
  // cadence deliberately — see MINIMAP_EVERY.
  const [viewer, setViewer] = useState<Viewer>({ x: 0, z: 0, heading: 0 });

  const mountRef = useRef<HTMLDivElement>(null);

  // Same seeding contract as the 2D host: the next build starts from the previous Scene so
  // a replay scrub moves buildings rather than teleporting them (docs/serve.md#3).
  const priorSceneRef = useRef<Scene | undefined>(undefined);
  const scene = useMemo(() => {
    const s = buildScene(units, edges, { priorScene: priorSceneRef.current });
    priorSceneRef.current = s;
    return s;
  }, [units, edges]);

  // The renderer and camera outlive individual scene rebuilds; only the graph is rebuilt.
  const rendererRef = useRef<THREE.WebGLRenderer>();
  const labelRendererRef = useRef<CSS2DRenderer>();
  const cameraRef = useRef<THREE.PerspectiveCamera>();
  const controlsRef = useRef<Controls3d>();
  const graphRef = useRef<THREE.Group>();
  const threeSceneRef = useRef<THREE.Scene>();

  // Latest handlers, read by the pointer listeners without re-subscribing them on
  // every store change (which would tear down and rebuild the whole WebGL context).
  const actionsRef = useRef({ select, drill, ascend });
  actionsRef.current = { select, drill, ascend };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    // jsdom has no WebGL; the host degrades to an empty container there and the object
    // graph, camera framing, and disposal are covered directly in scene3d.test.ts instead.
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      return;
    }

    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(mount.clientWidth, mount.clientHeight);
    labelRenderer.domElement.style.position = "absolute";
    labelRenderer.domElement.style.top = "0";
    labelRenderer.domElement.style.pointerEvents = "none";
    mount.appendChild(labelRenderer.domElement);
    labelRendererRef.current = labelRenderer;

    const threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color(0x0d1117);
    // Distance haze: buildings far down the rank axis fade out, which is what stops a
    // street-level view from reading as an undifferentiated wall of geometry.
    threeScene.fog = new THREE.Fog(0x0d1117, 400, 3000);
    threeSceneRef.current = threeScene;

    const keyRad = (KEY_LIGHT_DEG * Math.PI) / 180;
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(Math.cos(keyRad), 1.4, Math.sin(keyRad)).multiplyScalar(500);
    threeScene.add(key);
    threeScene.add(new THREE.AmbientLight(0xffffff, 0.55));

    const camera = new THREE.PerspectiveCamera(FOV_DEG, mount.clientWidth / mount.clientHeight, 1, 8000);
    cameraRef.current = camera;

    let frame = 0;
    let ticks = 0;
    const timer = new THREE.Timer();
    const tick = () => {
      frame = requestAnimationFrame(tick);
      timer.update();
      const dt = timer.getDelta();
      controlsRef.current?.update(dt);
      // Before rendering, not after: the CSS2D pass reads `visible` on the same frame.
      if (graphRef.current) cullLabels(graphRef.current, camera);
      renderer.render(threeScene, camera);
      labelRenderer.render(threeScene, camera);

      // Throttled: a setState every frame would re-render the whole subtree at 60Hz to move
      // one wedge a few pixels.
      if (++ticks % MINIMAP_EVERY === 0) {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        setViewer({ x: camera.position.x, z: camera.position.z, heading: Math.atan2(dir.x, -dir.z) });
      }
    };
    tick();

    const resize = new ResizeObserver(() => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      labelRenderer.setSize(w, h);
    });
    resize.observe(mount);

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      // The graph is disposed by the rebuild effect's own cleanup, which React runs before
      // this one; disposing it again here would double-free.
      // Frees the GL context itself. Without it, toggling skins repeatedly walks into the
      // browser's ~16 live-context cap and the oldest canvases start blanking out.
      disposeRenderer(renderer);
      labelRenderer.domElement.remove();
    };
  }, []);

  // Camera controls are attached in their own effect, because which controller is right is
  // not fixed for the life of the host: it follows the skin's declared camera model and the
  // current view. `walkable` skins swap walk<->fly on the toggle; the orbit skin swaps
  // orbit<->walk. Rebuilding here rather than in the mount effect keeps the WebGL context —
  // and everything on the ~16-context budget — untouched by a mere change of controller.
  useEffect(() => {
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    if (!camera || !renderer) return;
    const make = walkable ? (view === "street" ? walkControls : flyControls) : view === "street" ? walkControls : orbitControls;
    const controls = make(camera, renderer.domElement);
    controlsRef.current = controls;
    return () => {
      controls.dispose();
      controlsRef.current = undefined;
    };
  }, [walkable, view]);

  // Rebuild the graph when the scene or delta data changes, disposing the previous one
  // first — a rebuild that only detaches would leak every geometry and material it dropped.
  // Deliberately not keyed on `selection`: focus is applied in place below, because
  // rebuilding the whole city on every click would churn the GPU for a change of opacity.
  useEffect(() => {
    const threeScene = threeSceneRef.current;
    if (!threeScene) return;
    const graph = buildSceneGraph(scene, { deltaByUnit, skin });
    threeScene.add(graph);
    graphRef.current = graph;
    return () => {
      threeScene.remove(graph);
      disposeGraph(graph);
      graphRef.current = undefined;
    };
  }, [scene, deltaByUnit, skin]);

  // Focus is a property write on the existing materials, not a rebuild.
  useEffect(() => {
    if (graphRef.current) applyFocus(graphRef.current, selection);
  }, [selection, scene, deltaByUnit]);

  // Reframe on a view switch or a change of navigation level, and on nothing else. The
  // distinction is scene identity versus level: a replay scrub rebuilds the scene at the
  // same level and must leave the camera where the user put it, but drilling enters a new
  // city entirely — keeping the old framing there leaves you inside a building at the wrong
  // scale, which is what `scene`-keyed reframing and `view`-only reframing each get wrong in
  // opposite directions.
  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const { position, target } = frameScene(scene, view);
    camera.position.copy(position);
    // Orbit is the only model with a look-at point to write; walk and fly carry their
    // heading on the camera itself, so they are aimed rather than targeted.
    if (controls.target) controls.target.copy(target);
    else camera.lookAt(target);
    controls.update(0);
    // `scene` is deliberately not a dependency: it is read for its bounds, but a rebuild at
    // the same level must not re-frame.
  }, [view, focus, walkable]);

  // Pointer verbs. Bound to the mount rather than the canvas so they survive a renderer
  // swap, and gated on drag distance so releasing an orbit gesture never selects a unit.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let downAt: { x: number; y: number } | null = null;

    const pick = (e: MouseEvent): string | null => {
      const camera = cameraRef.current;
      const graph = graphRef.current;
      if (!camera || !graph) return null;
      const rect = mount.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(graph.children, true);
      return hits.length > 0 ? unitAt(hits[0]!.object) : null;
    };

    const onDown = (e: MouseEvent) => {
      downAt = { x: e.clientX, y: e.clientY };
    };

    const dragged = (e: MouseEvent): boolean =>
      downAt !== null && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > DRAG_THRESHOLD;

    const onUp = (e: MouseEvent) => {
      if (dragged(e)) return;
      actionsRef.current.select(pick(e));
    };

    const onDoubleClick = (e: MouseEvent) => {
      if (dragged(e)) return;
      const id = pick(e);
      // Double-clicking empty sky ascends, mirroring the 2D canvas (docs/serve.md#4).
      if (id) actionsRef.current.drill(id);
      else actionsRef.current.ascend();
    };

    mount.addEventListener("mousedown", onDown);
    mount.addEventListener("mouseup", onUp);
    mount.addEventListener("dblclick", onDoubleClick);
    return () => {
      mount.removeEventListener("mousedown", onDown);
      mount.removeEventListener("mouseup", onUp);
      mount.removeEventListener("dblclick", onDoubleClick);
    };
  }, []);

  return (
    <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
      <div ref={mountRef} data-testid="canvas-3d" style={{ position: "absolute", inset: 0, overflow: "hidden" }} />
      <button
        type="button"
        className="view-toggle"
        onClick={() => setView((v) => (v === "orbit" ? "street" : "orbit"))}
        style={{ position: "absolute", top: 12, right: 12, zIndex: 1 }}
      >
        {walkable ? (view === "street" ? "Fly" : "Walk") : view === "orbit" ? "Street view" : "Overview"}
      </button>
      {walkable && <Minimap scene={scene} viewer={viewer} selection={selection} />}
    </div>
  );
}

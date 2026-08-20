import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { Edge, Unit } from "@scv/schema";
import { buildScene, type Scene } from "@scv/layout";
import { useAppStore } from "./store.js";
import { buildSceneGraph, disposeGraph, frameScene, unitAt, type ViewMode } from "./scene3d.js";
import type { TileDeltaInfo } from "./CanvasHost.js";

export type Canvas3dHostProps = {
  units: Unit[];
  edges: Edge[];
  /** Present only in delta mode (docs/serve.md#2). */
  deltaByUnit?: Map<string, TileDeltaInfo>;
};

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
export function Canvas3dHost({ units, edges, deltaByUnit }: Canvas3dHostProps): JSX.Element {
  const select = useAppStore((s) => s.select);
  const drill = useAppStore((s) => s.drill);
  const ascend = useAppStore((s) => s.ascend);
  const selection = useAppStore((s) => s.selection);
  const [view, setView] = useState<ViewMode>("orbit");

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
  const controlsRef = useRef<OrbitControls>();
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

    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 1, 8000);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controlsRef.current = controls;

    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      controls.update();
      renderer.render(threeScene, camera);
      labelRenderer.render(threeScene, camera);
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
      controls.dispose();
      if (graphRef.current) disposeGraph(graphRef.current);
      // Frees the GL context itself. Without it, toggling skins repeatedly walks into the
      // browser's ~16 live-context cap and the oldest canvases start blanking out.
      renderer.dispose();
      renderer.domElement.remove();
      labelRenderer.domElement.remove();
    };
  }, []);

  // Rebuild the graph whenever the scene or its context changes, disposing the previous one
  // first — a rebuild that only detaches would leak every geometry and material it dropped.
  useEffect(() => {
    const threeScene = threeSceneRef.current;
    if (!threeScene) return;
    if (graphRef.current) {
      threeScene.remove(graphRef.current);
      disposeGraph(graphRef.current);
    }
    const graph = buildSceneGraph(scene, { deltaByUnit, focusId: selection ?? undefined });
    threeScene.add(graph);
    graphRef.current = graph;
  }, [scene, deltaByUnit, selection]);

  // Reframe on an explicit view change only. Re-framing on every scene rebuild would yank
  // the camera back to the overview mid-navigation.
  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const { position, target } = frameScene(scene, view);
    camera.position.copy(position);
    controls.target.copy(target);
    controls.update();
    // `scene` is deliberately not a dependency: it is read for its bounds, but a scene
    // rebuild must not re-frame. Only a view switch may move the camera.
  }, [view]);

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
        {view === "orbit" ? "Street view" : "Overview"}
      </button>
    </div>
  );
}

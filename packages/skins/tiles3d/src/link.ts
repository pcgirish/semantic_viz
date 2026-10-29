import * as THREE from "three";
import type { SceneLink } from "@semviz/layout";

const FULL_OPACITY = 1;
const GATED_OPACITY = 0.15;

export type LinkOptions = {
  /** True once links.length > nodes.length * 1.6 (docs/serve.md#3, "density gating"). */
  gated?: boolean;
  /** Hovered/selected unit id — an edge touching it stays at full strength even when gated. */
  focusId?: string;
};

/**
 * Renders one SceneLink as a ground-plane THREE.Line following the routed path — the
 * routing channels double as a cityscape's streets (docs/serve.md#180, "Streets come
 * free"). Density gating fades background edges translucent; edges touching the focused
 * unit stay at full strength (docs/serve.md#182, "occlusion is the cost paid explicitly").
 */
export function link(l: SceneLink, options: LinkOptions = {}): THREE.Line {
  const touchesFocus = options.focusId !== undefined && (l.from === options.focusId || l.to === options.focusId);
  const faint = Boolean(options.gated) && !touchesFocus;

  const points = l.path.map((p) => new THREE.Vector3(p.x, 0, p.y));
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    transparent: true,
    opacity: faint ? GATED_OPACITY : FULL_OPACITY,
  });

  const line = new THREE.Line(geometry, material);
  line.name = l.id;
  return line;
}

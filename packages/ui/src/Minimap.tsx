import { minimapProjection, type Viewer } from "@semviz/skin-cityscape";
import type { Scene } from "@semviz/layout";
import { codedreamLayerPalette, hashLayerToColor } from "@semviz/skin-tiles";

const SIZE = 168;

export type MinimapProps = {
  scene: Scene;
  viewer: Viewer;
  /** Highlighted unit, so the map agrees with the selection in the rest of the app. */
  selection?: string | null;
};

/**
 * The top-down inset that makes street level navigable (docs/serve.md#189).
 *
 * Checkpoint 2 established that this is load-bearing rather than decorative. Rank — the axis
 * the whole layout is built on — survives being looked at from orbit but not being stood in:
 * once the camera is inside the scene, rank is a direction you walk rather than something you
 * see, and no other channel recovers it (hue is layer, height is sloc). The map is the only
 * instrument that can answer "which way is up the dependency graph?".
 *
 * The heading wedge is the half of that answer position alone cannot give: knowing where you
 * are on the map still leaves you unable to say whether walking forward takes you up-rank or
 * down.
 *
 * Drawn as SVG rather than a second WebGL view deliberately — it costs no context against the
 * browser's ~16 live-context budget, and it is the same top-down geometry the 2D skin draws.
 */
export function Minimap({ scene, viewer, selection }: MinimapProps): JSX.Element {
  const p = minimapProjection(scene, { width: SIZE, height: SIZE }, viewer);

  // World -Z is the direction the camera looks at heading 0, and map +Y is world +Z, so the
  // wedge points up the map when the walker faces up-rank.
  const wedge = 22;

  return (
    <svg
      data-testid="minimap"
      className="scene3d-minimap"
      width={SIZE}
      height={SIZE}
      style={{ position: "absolute", bottom: 12, left: 12, zIndex: 1 }}
      aria-label="Minimap"
    >
      {p.nodes.map((n) => (
        <rect
          key={n.id}
          x={n.x - n.r}
          y={n.y - n.r}
          width={n.r * 2}
          height={n.r * 2}
          // Same hue as the building it stands for, so the district ahead of you and the
          // district on the map are recognisably the same place.
          fill={n.layer ? hashLayerToColor(n.layer, codedreamLayerPalette) : "#6b7280"}
          opacity={selection && selection !== n.id ? 0.45 : 1}
          stroke={selection === n.id ? "#f2a93b" : "none"}
          strokeWidth={selection === n.id ? 1.5 : 0}
        />
      ))}
      {/*
        Risk, carried over from the same `ring` flag the 3D skin grows its beacon from. The
        beacon stops a flagged unit hiding behind a taller neighbour, but from inside a dense
        block it can still be out of frame entirely; the map is the vantage that cannot be
        occluded. Drawn after the footprints so it is never covered, and unaffected by
        selection dimming — finding what you have not selected yet is the point.
      */}
      {p.nodes
        .filter((n) => n.risk)
        .map((n) => (
          <circle
            key={`risk-${n.id}`}
            data-testid="minimap-risk"
            data-node={n.id}
            cx={n.x}
            cy={n.y}
            r={Math.max(n.r * 0.5, 2)}
            fill="#f2564b"
            stroke="rgba(0,0,0,.45)"
            strokeWidth={0.75}
          />
        ))}
      <g transform={`translate(${p.viewer.x} ${p.viewer.y}) rotate(${(p.viewer.heading * 180) / Math.PI})`}>
        <polygon points={`0,${-wedge} ${wedge * 0.4},${wedge * 0.3} ${-wedge * 0.4},${wedge * 0.3}`} fill="rgba(255,255,255,.22)" />
        <circle r={3} fill="#ffffff" />
      </g>
    </svg>
  );
}

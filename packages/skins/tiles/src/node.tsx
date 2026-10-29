import type { CSSProperties, MouseEvent, ReactElement } from "react";
import { PolyNode, type FocusState } from "@semviz/design-system";
import type { SceneNode } from "@semviz/layout";
import type { DeltaInfo, RenderContext } from "@semviz/skin-contract";

const HIGH_RISK = 0.5;

type TileShape = "diamond" | "square" | "chamfer" | "hex" | "hex-tall";

/**
 * Complexity as tile shape (docs/serve.md#2, "sides = complexity"). Flowchart decision and
 * loop blocks override it — a diamond is the block's meaning, not its complexity.
 */
export function shapeFor(n: Pick<SceneNode, "sides"> & { blockType?: string }): TileShape {
  if (n.blockType === "decision" || n.blockType === "loop") return "diamond";
  if (n.sides === 0) return "hex-tall";
  if (n.sides === 3) return "square";
  if (n.sides === 6) return "hex";
  return "chamfer";
}

// --temp-4 (#F2A93B, "changed") as an RGB triple — color-mix() can't be computed inline
// from a JS number, so the delta amount->alpha mix below is done as literal rgba math.
const CHANGED_RGB = "242, 169, 59";

/** Delta-mode tile styling (docs/serve.md#2): fill saturation encodes amount, added/removed
 *  get dedicated outlines rather than colour alone. */
export function deltaStyle(d: DeltaInfo | undefined): CSSProperties {
  if (!d) return {};
  if (d.status === "added") return { outline: "2px solid var(--temp-2)", borderRadius: 6 };
  if (d.status === "removed") return { outline: "1.6px dashed var(--temp-6)", borderRadius: 6 };
  if (d.status === "modified" || d.status === "risk_changed" || d.status === "rollup") {
    return { background: `rgba(${CHANGED_RGB}, ${(d.amount ?? 0) * 0.7})`, borderRadius: 6 };
  }
  return {};
}

/** Offset risk ring (docs/serve.md#2) — drawn as a shadow so it reads outside the tile's box. */
function riskStyle(d: DeltaInfo | undefined): CSSProperties {
  const atRisk = d?.risk !== null && d?.risk !== undefined && d.risk >= HIGH_RISK;
  return atRisk ? { filter: "drop-shadow(0 0 0 1px var(--temp-6))" } : {};
}

/** Which way a tile's edges run to the sibling currently highlighted in the tray. */
export type Coupling = "in" | "out" | "both";

/** Matches the in/out vocabulary the hover trace already uses for real connectors. */
const COUPLING_COLOR = { in: "var(--cool-azure)", out: "var(--temp-4)" } as const;

/**
 * Coupling as the tile's face colour — the tray's crossing edges have no second tile to draw a
 * connector to, since the sibling they address is a tray row rather than something on the canvas.
 *
 * This has to reach the polygon itself. PolyNode lays an absolutely positioned Facet SVG over the
 * element (inset:0), so a background behind it is covered by that path's own fill; the face is
 * painted via `color`/`fillTo` instead. A tile coupled both ways takes each direction as one stop
 * of the face gradient, so it reads as its two colours rather than blending into a third.
 */
export function couplingFace(
  c: Coupling | undefined,
): { color: string; fillTo?: string } | null {
  if (!c) return null;
  if (c === "both") return { color: COUPLING_COLOR.out, fillTo: COUPLING_COLOR.in };
  return { color: COUPLING_COLOR[c] };
}

/**
 * The shared RenderContext (delta, layer hue) plus what only a DOM host can supply:
 * where the scroll origin is, and the handlers to bind. Extending rather than redeclaring
 * means `tilesSkin.node` can pass a plain RenderContext straight through, uncast.
 */
export type TileContext = RenderContext & {
  /** Scene-space origin the tile's absolute position is measured from. */
  origin?: { x: number; y: number };
  focus?: FocusState;
  /** Set only on tiles the tray's highlighted sibling couples to. */
  coupling?: Coupling;
  onFocusNode?: (id: string) => void;
  onClick?: (e: MouseEvent) => void;
  onDoubleClick?: (e: MouseEvent) => void;
};

/**
 * Renders one Scene node as a design-system PolyNode positioned in scene coordinates.
 * This is the canonical 2D tile — the skin owns "a SceneNode looks like this", so a host
 * places it and never restyles it (docs/serve.md#1).
 */
export function node(n: SceneNode, ctx: TileContext = {}): ReactElement {
  const origin = ctx.origin ?? { x: 0, y: 0 };
  const shape = shapeFor(n);
  return (
    <PolyNode
      id={n.id}
      data-id={n.id}
      data-shape={shape}
      data-color={ctx.layerColor}
      className="tile"
      label={n.name}
      shape={shape}
      size={n.w}
      // A coupling highlight wins over the layer hue and renders solid: it answers the question
      // the pointer is asking right now, and an alpha wash over the hue would not read as either.
      color={couplingFace(ctx.coupling)?.color ?? ctx.layerColor}
      fillTo={couplingFace(ctx.coupling)?.fillTo}
      filled={ctx.coupling !== undefined}
      focus={ctx.focus}
      onFocusNode={ctx.onFocusNode}
      style={
        {
          position: "absolute",
          left: n.x - origin.x,
          top: n.y - origin.y,
          height: n.h,
          ...deltaStyle(ctx.delta),
          ...riskStyle(ctx.delta),
        } as CSSProperties
      }
      onClick={ctx.onClick}
      onDoubleClick={ctx.onDoubleClick}
    />
  );
}

import type { CSSProperties, MouseEvent, ReactElement } from "react";
import { PolyNode, type FocusState } from "@scv/design-system";
import type { SceneNode } from "@scv/layout";
import type { DeltaInfo, RenderContext } from "@scv/skin-contract";

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

/**
 * A boundary marker stands for a unit *outside* the focused subtree, so it is deliberately
 * quieter than a real tile: dimmed, and labelled with the external unit's name plus how many
 * concrete edges collapsed into it ("14 calls" rather than an opaque summed weight).
 */
const BOUNDARY_DIM = "opacity(0.55)";

/** One glyph per direction, so the common render path is a lookup rather than two comparisons. */
const BOUNDARY_GLYPH = { in: "\u2190", out: "\u2192", both: "\u2194" } as const;

/**
 * The shared RenderContext (delta, layer hue) plus what only a DOM host can supply:
 * where the scroll origin is, and the handlers to bind. Extending rather than redeclaring
 * means `tilesSkin.node` can pass a plain RenderContext straight through, uncast.
 */
export type TileContext = RenderContext & {
  /** Scene-space origin the tile's absolute position is measured from. */
  origin?: { x: number; y: number };
  focus?: FocusState;
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
  const boundary = n.boundary;
  return (
    <PolyNode
      id={n.id}
      data-id={n.id}
      data-shape={shape}
      data-color={ctx.layerColor}
      data-boundary={boundary?.direction}
      data-boundary-glyph={boundary ? BOUNDARY_GLYPH[boundary.direction] : undefined}
      className="tile"
      label={boundary ? `${BOUNDARY_GLYPH[boundary.direction]} ${n.name} (${boundary.edgeCount})` : n.name}
      shape={shape}
      size={n.w}
      color={ctx.layerColor}
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
          // Dimming rides on `filter`, not `opacity`: PolyNode owns `opacity` for hover
          // dimming and this style object spreads *after* it, so setting opacity here would
          // make a marker brighten whenever another tile is hovered.
          ...(boundary ? { filter: [riskStyle(ctx.delta).filter, BOUNDARY_DIM].filter(Boolean).join(" ") } : {}),
        } as CSSProperties
      }
      onClick={ctx.onClick}
      onDoubleClick={ctx.onDoubleClick}
    />
  );
}

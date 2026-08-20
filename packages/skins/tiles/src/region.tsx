import type { ReactElement } from "react";
import type { SceneRegion } from "@scv/layout";

export type RegionContext = {
  /** Scene-space origin the region's absolute position is measured from. */
  origin?: { x: number; y: number };
};

/**
 * Renders one Scene region as a dashed box with an uppercase tab label — the architecture-level
 * grouping drawn into the existing canvas, not a separate view. Regions are keyed on a layer's
 * `group`, so one box can span several layer hues; it is deliberately uncoloured for that reason.
 * Never takes pointer events: a region overlaps the tiles inside it.
 */
export function region(r: SceneRegion, ctx: RegionContext = {}): ReactElement {
  const origin = ctx.origin ?? { x: 0, y: 0 };
  return (
    <div
      className="region"
      data-id={r.id}
      style={{
        position: "absolute",
        left: r.x - origin.x,
        top: r.y - origin.y,
        width: r.w,
        height: r.h,
        pointerEvents: "none",
        border: "var(--border-w) dashed var(--border-1)",
        borderRadius: "var(--radius-md)",
        background: "rgba(152,174,191,0.035)",
      }}
    >
      <span
        className="region-label"
        style={{
          position: "absolute",
          top: -9,
          left: 12,
          padding: "1px 8px 1px 6px",
          background: "var(--surface-3)",
          color: "var(--text-faint)",
          font: "600 10px var(--font-mono)",
          textTransform: "uppercase",
          letterSpacing: "0.09em",
          clipPath: "var(--clip-chamfer-sm)",
          border: "var(--border-w) solid var(--border-1)",
          whiteSpace: "nowrap",
        }}
      >
        {r.name.toUpperCase()}
      </span>
    </div>
  );
}

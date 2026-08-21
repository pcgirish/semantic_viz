import { Fragment, type CSSProperties } from "react";
import type { RenderSkin, ViewMode } from "./store.js";

export type ControlsHelpProps = {
  skin: RenderSkin;
  view: ViewMode;
};

const labelStyle: CSSProperties = {
  font: "var(--weight-semibold) var(--text-xs) var(--font-core)",
  color: "var(--text-faint)",
  textTransform: "uppercase",
  letterSpacing: "0.09em",
};

const rowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  gap: "var(--space-2) var(--space-3)",
  font: "var(--text-xs)",
  color: "var(--text-dim)",
  lineHeight: 1.6,
};

const keyStyle: CSSProperties = {
  font: "10px var(--font-mono)",
  color: "var(--text-faint)",
  whiteSpace: "nowrap",
};

type Binding = [gesture: string, effect: string];

/**
 * What the current camera responds to. Each 3D camera has a different control model and none
 * of them announce themselves: a drag means orbit in one and look in another, and the
 * cityscape's zoom-to-drill has no affordance at all — the camera moving *is* the gesture.
 * Kept in sync with `controls3d.ts`, which is where the models actually live.
 */
function bindings(skin: RenderSkin, view: ViewMode): Binding[] | null {
  if (skin === "tiles3d") {
    return [
      ["Drag", "orbit around the city"],
      ["Scroll", "zoom in and out"],
      ["Click", "inspect a building"],
      ["Double-click", "open it"],
    ];
  }
  if (skin !== "cityscape") return null;

  if (view === "street") {
    return [
      ["Click", "lock the pointer to look around"],
      ["Esc", "release the pointer"],
      ["WASD / arrows", "walk"],
      ["Walk close to a building", "opens it; back away to leave"],
      ["Minimap", "your position and facing, bottom-left"],
    ];
  }
  return [
    ["Drag", "look around"],
    ["WASD / arrows", "fly across the city"],
    ["R / F", "rise and descend"],
    ["Double-click", "open a building"],
  ];
}

/**
 * A short key-and-mouse legend for whichever 3D camera is current, rendered beside the
 * encoding legend in the same always-visible rail. The 2D skin needs none — a tile grid has
 * no camera to explain.
 */
export function ControlsHelp({ skin, view }: ControlsHelpProps): JSX.Element | null {
  const rows = bindings(skin, view);
  if (!rows) return null;

  return (
    <div
      data-testid="controls-help"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        borderTop: "var(--border-w) solid var(--border-hair)",
        paddingTop: "var(--space-3)",
        marginTop: "var(--space-3)",
      }}
    >
      <div style={labelStyle}>{view === "street" ? "Walking" : "Navigating"}</div>
      <div style={rowStyle}>
        {rows.map(([gesture, effect]) => (
          <Fragment key={gesture}>
            <span style={keyStyle}>{gesture}</span>
            <span>{effect}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

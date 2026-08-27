import type { CSSProperties } from "react";
import { Tray } from "@scv/design-system";
import type { SiblingSummary } from "./App.js";

/** One glyph per direction, so the row's render path is a lookup rather than two comparisons. */
const DIRECTION_GLYPH = { in: "←", out: "→", both: "↔" } as const;

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "var(--space-2)",
  padding: "var(--space-2) var(--space-3)",
  borderRadius: "var(--radius-md)",
  border: "var(--border-w) solid var(--border-1)",
  background: "var(--surface-2)",
  fontSize: "var(--text-xs)",
  color: "var(--text-body)",
};

export type ConnectedSiblingsTrayProps = {
  siblings: SiblingSummary[];
  /** Id of the row whose highlight is pinned, or null. */
  pinned: string | null;
  onHover: (id: string | null) => void;
  onTogglePin: (id: string) => void;
  /** Open on mount. False on a canvas too narrow for the overlay not to swallow the scene. */
  defaultOpen?: boolean;
  /** Upper bound for the row list, so the tray never outgrows the canvas or adds a second
   *  scrollbar to `.canvas-scroll`. */
  maxHeight?: number;
  style?: CSSProperties;
};

/**
 * The connected-siblings tray: one row per sibling of the focused unit, listing how many edges
 * cross the focus boundary to it and in which direction. Modelled on EntryPointsRail — the tray
 * lists what to highlight, the canvas shows the result.
 *
 * Rows are deliberately rows and not tiles. Their predecessor, the boundary-marker column, drew
 * each sibling as a dimmed PolyNode in scene space, which read as "a less important module"
 * rather than "a different kind of thing" — and asserted a relationship the scene graph had no
 * record of, since hovering one highlighted nothing.
 *
 * Kind-agnostic on purpose: siblings are whatever kind the focused unit is (drill a group and
 * they are groups, drill a layer and they are layers), so no copy here names a kind.
 */
export function ConnectedSiblingsTray({
  siblings,
  pinned,
  onHover,
  onTogglePin,
  defaultOpen = true,
  maxHeight,
  style,
}: ConnectedSiblingsTrayProps): JSX.Element | null {
  if (siblings.length === 0) return null;

  return (
    <div
      data-testid="connected-siblings-tray"
      // Hovering a row must not reach `.canvas-scroll`'s onMouseLeave (which clears the tile
      // hover) or start a pan on mousedown.
      onMouseDown={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
      onMouseLeave={(e) => {
        e.stopPropagation();
        onHover(null);
      }}
      style={{ pointerEvents: "auto", ...style }}
    >
      <Tray title="Connected siblings" dock="right" floating collapsible defaultOpen={defaultOpen} width={240}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxHeight, overflowY: "auto" }}>
          {siblings.map((s) => {
            const linked = s.direction !== null;
            return (
              <div
                key={s.id}
                data-testid={`sibling-row-${s.id}`}
                data-linked={linked ? "true" : "false"}
                data-pinned={pinned === s.id ? "true" : undefined}
                onMouseEnter={linked ? () => onHover(s.id) : undefined}
                onClick={linked ? () => onTogglePin(s.id) : undefined}
                style={{
                  ...rowStyle,
                  cursor: linked ? "pointer" : "default",
                  // A sibling with no crossing edges is shown rather than omitted: absent is
                  // indistinguishable from broken. Greyed and inert says "not coupled".
                  color: linked ? rowStyle.color : "var(--text-faint)",
                  outline: pinned === s.id ? "1px solid var(--accent-lift)" : undefined,
                }}
              >
                {linked && <span aria-hidden="true">{DIRECTION_GLYPH[s.direction!]}</span>}
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.name}
                </span>
                <span style={{ color: "var(--text-faint)", fontVariantNumeric: "tabular-nums", flex: "0 0 auto" }}>
                  {linked ? `${s.edgeCount} links` : "no links"}
                </span>
              </div>
            );
          })}
        </div>
      </Tray>
    </div>
  );
}

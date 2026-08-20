import type { CSSProperties } from "react";
import { GroupFrame, TEMP_STOPS } from "@scv/design-system";
import type { Unit } from "@scv/schema";
import { codedreamLayerPalette, hashLayerToColor } from "@scv/skin-tiles";

export type LegendProps = {
  units: Unit[];
  /** Gates the Temperature/Connectors/Navigating sections — they only mean something
   * where nodes carry a temp or the canvas supports drill/select (docs mock's renderLegend). */
  mode?: "current" | "delta" | "depends" | "flows";
};

const railLabelStyle: CSSProperties = {
  font: "var(--weight-semibold) var(--text-xs) var(--font-core)",
  color: "var(--text-faint)",
  textTransform: "uppercase",
  letterSpacing: "0.09em",
};

/**
 * Group header rows (the architecture-level grouping) with their member layers nested
 * as sub-bullets underneath, each still colored the same way tiles are (hashed stable
 * layer id, CodeDream cool-accent palette). A layer with no group falls under a
 * catch-all "other" header.
 */
export function Legend({ units, mode = "current" }: LegendProps): JSX.Element | null {
  const layers = units.filter((u) => u.kind === "layer");
  if (layers.length === 0) return null;

  const layersByGroup = new Map<string, Unit[]>();
  for (const layer of layers) {
    const group = layer.group ?? "other";
    (layersByGroup.get(group) ?? layersByGroup.set(group, []).get(group)!).push(layer);
  }

  const showNav = mode === "current" || mode === "delta";
  const showTemp = mode === "current" || mode === "delta";

  return (
    <>
      {[...layersByGroup.entries()].map(([group, groupLayers]) => (
        // GroupFrame floats its label at top:-9px, which the enclosing Tray (overflow:
        // hidden) would clip; reserve that much room above each frame instead.
        <GroupFrame label={group} key={group} style={{ marginTop: 12, minWidth: 0 }}>
          {groupLayers.map((layer) => (
            <div key={layer.id} style={{ display: "flex", alignItems: "center", gap: "var(--gap-sm)" }}>
              <span
                className="chip"
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: hashLayerToColor(layer.id, codedreamLayerPalette),
                }}
              />
              {layer.name}
            </div>
          ))}
        </GroupFrame>
      ))}
      <details open style={{ borderTop: "var(--border-w) solid var(--border-hair)", marginTop: "var(--space-3)" }}>
        <summary style={{ ...railLabelStyle, padding: "var(--space-2) 0", cursor: "pointer", listStyle: "none" }}>
          Legend
        </summary>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", paddingBottom: "var(--space-3)" }}>
          {showTemp && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <div style={railLabelStyle}>Temperature scale</div>
              <div style={{ display: "flex", gap: 2, marginTop: 4 }}>
                {TEMP_STOPS.map((s) => (
                  <span
                    key={s.key}
                    title={s.label}
                    style={{ flex: 1, height: 12, background: s.token, clipPath: "var(--clip-chamfer-sm)" }}
                  />
                ))}
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  font: "10px var(--font-mono)",
                  color: "var(--text-faint)",
                  textTransform: "uppercase",
                  letterSpacing: "0.09em",
                }}
              >
                <span>Dormant</span>
                <span>Critical</span>
              </div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <div style={railLabelStyle}>Complexity</div>
            <div style={{ font: "var(--text-xs)", color: "var(--text-dim)", lineHeight: 1.8 }}>
              △ 1-2 · Trivial
              <br />
              ◇ 3-5 · Ordinary
              <br />
              ● 6-12 · Involved
              <br />
              ● 13+ · Look here
            </div>
          </div>
          {showNav && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <div style={railLabelStyle}>Connectors</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, font: "var(--text-xs)", color: "var(--text-dim)" }}>
                <span>
                  <span style={{ display: "inline-block", width: 14, height: 2, background: "var(--connector-active)", verticalAlign: "middle", marginRight: 6 }} />
                  calls
                </span>
                <span>
                  <span style={{ display: "inline-block", width: 14, height: 2, background: "var(--cool-indigo)", verticalAlign: "middle", marginRight: 6 }} />
                  imports
                </span>
              </div>
              <div style={{ ...railLabelStyle, marginTop: 8 }}>On hover</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, font: "var(--text-xs)", color: "var(--text-dim)" }}>
                <span>
                  <span style={{ display: "inline-block", width: 14, height: 2, background: "var(--cool-azure)", verticalAlign: "middle", marginRight: 6 }} />
                  incoming
                </span>
                <span>
                  <span style={{ display: "inline-block", width: 14, height: 2, background: "var(--temp-4)", verticalAlign: "middle", marginRight: 6 }} />
                  outgoing
                </span>
              </div>
            </div>
          )}
          {showNav && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <div style={railLabelStyle}>Navigating</div>
              <div style={{ font: "var(--text-xs)", color: "var(--text-dim)", lineHeight: 1.6 }}>
                Click a node to inspect it. Double-click (hex nodes) to open. Double-click empty canvas, or Zoom out
                above, to go back up.
              </div>
            </div>
          )}
        </div>
      </details>
    </>
  );
}

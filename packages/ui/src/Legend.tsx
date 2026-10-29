import { useState, type CSSProperties } from "react";
import { GroupFrame, TEMP_STOPS } from "@semviz/design-system";
import type { Unit } from "@semviz/schema";
import { codedreamLayerPalette, hashLayerToColor } from "@semviz/skin-tiles";

export type LegendProps = {
  units: Unit[];
  /** Gates the Temperature/Connectors/Navigating sections — they only mean something
   * where nodes carry a temp or the canvas supports drill/select (docs mock's renderLegend). */
  mode?: "current" | "delta" | "depends" | "flows";
};

/**
 * How many groups render with their layers showing.
 *
 * A real repository clusters into 15+ top-level groups where `fixtures/orderly` has 6
 * (docs/implement-serve.md:121-131), and every one expanded turns the rail into a scroll of
 * chips — the legend stops being readable at a glance, which is the only thing it is for.
 * The rest keep a visible row you can open, so nothing becomes unreachable. This is the UI
 * half of that problem; capping the clustering itself is the Interpreter's half.
 */
const EXPANDED_GROUPS = 6;

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
export function Legend({
  units,
  mode = "current",
}: LegendProps): JSX.Element | null {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const layers = units.filter((u) => u.kind === "layer");
  if (layers.length === 0) return null;

  // Keyed on the group unit's id, not its name: names are LLM-authored and not unique, so
  // keying on the name silently merged two distinct groups into one frame.
  const unitsById = new Map(units.map((u) => [u.id, u]));
  const UNGROUPED = "";
  const layersByGroup = new Map<string, Unit[]>();
  for (const layer of layers) {
    const parent = layer.parent ? unitsById.get(layer.parent) : undefined;
    const groupId = parent?.kind === "group" ? parent.id : UNGROUPED;
    (
      layersByGroup.get(groupId) ?? layersByGroup.set(groupId, []).get(groupId)!
    ).push(layer);
  }

  const showNav = mode === "current" || mode === "delta";
  const showTemp = mode === "current" || mode === "delta";

  return (
    <>
      {[...layersByGroup.entries()].map(([groupId, groupLayers], i) => {
        const label =
          groupId === UNGROUPED
            ? "other"
            : (unitsById.get(groupId)?.name ?? groupId);
        return (
          // GroupFrame floats its label at top:-9px, which the enclosing Tray (overflow:
          // hidden) would clip; reserve that much room above each frame instead.
          <GroupFrame
            label={label}
            key={groupId}
            style={{ marginTop: 12, minWidth: 0 }}
          >
            {i < EXPANDED_GROUPS || expanded.has(groupId) ? (
              groupLayers.map((layer) => (
                <div
                  key={layer.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--gap-sm)",
                  }}
                >
                  <span
                    className="chip"
                    style={{
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: hashLayerToColor(
                        layer.id,
                        codedreamLayerPalette,
                      ),
                    }}
                  />
                  {layer.name}
                </div>
              ))
            ) : (
              <button
                type="button"
                onClick={() => setExpanded((s) => new Set(s).add(groupId))}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  font: "var(--text-xs)",
                  color: "var(--text-faint)",
                  textAlign: "left",
                }}
              >
                Show {groupLayers.length}{" "}
                {groupLayers.length === 1 ? "layer" : "layers"}
              </button>
            )}
          </GroupFrame>
        );
      })}
      <details
        open
        style={{
          borderTop: "var(--border-w) solid var(--border-hair)",
          marginTop: "var(--space-3)",
        }}
      >
        <summary
          style={{
            ...railLabelStyle,
            padding: "var(--space-2) 0",
            cursor: "pointer",
            listStyle: "none",
          }}
        >
          Legend
        </summary>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
            paddingBottom: "var(--space-3)",
          }}
        >
          {showTemp && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
              }}
            >
              <div style={railLabelStyle}>Temperature scale</div>
              <div style={{ display: "flex", gap: 2, marginTop: 4 }}>
                {TEMP_STOPS.map((s) => (
                  <span
                    key={s.key}
                    title={s.label}
                    style={{
                      flex: 1,
                      height: 12,
                      background: s.token,
                      clipPath: "var(--clip-chamfer-sm)",
                    }}
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
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
            }}
          >
            <div style={railLabelStyle}>Complexity</div>
            <div
              style={{
                font: "var(--text-xs)",
                color: "var(--text-dim)",
                lineHeight: 1.8,
              }}
            >
              △ 1-2 · Trivial
              <br />
              ◇ 3-5 · Ordinary
              <br />
              ● 6-12 · Involved
              <br />● 13+ · Look here
            </div>
          </div>
          {showNav && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
              }}
            >
              <div style={railLabelStyle}>Connectors</div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  font: "var(--text-xs)",
                  color: "var(--text-dim)",
                }}
              >
                <span>
                  <span
                    style={{
                      display: "inline-block",
                      width: 14,
                      height: 2,
                      background: "var(--connector-active)",
                      verticalAlign: "middle",
                      marginRight: 6,
                    }}
                  />
                  calls
                </span>
                <span>
                  <span
                    style={{
                      display: "inline-block",
                      width: 14,
                      height: 2,
                      background: "var(--cool-indigo)",
                      verticalAlign: "middle",
                      marginRight: 6,
                    }}
                  />
                  imports
                </span>
              </div>
              <div
                style={{
                  font: "var(--text-xs)",
                  color: "var(--text-dim)",
                  lineHeight: 1.6,
                  marginTop: 4,
                }}
              >
                A → B: A depends on B (B renders above A)
              </div>
              <div style={{ ...railLabelStyle, marginTop: 8 }}>On hover</div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  font: "var(--text-xs)",
                  color: "var(--text-dim)",
                }}
              >
                <span>
                  <span
                    style={{
                      display: "inline-block",
                      width: 14,
                      height: 2,
                      background: "var(--cool-azure)",
                      verticalAlign: "middle",
                      marginRight: 6,
                    }}
                  />
                  incoming
                </span>
                <span>
                  <span
                    style={{
                      display: "inline-block",
                      width: 14,
                      height: 2,
                      background: "var(--temp-4)",
                      verticalAlign: "middle",
                      marginRight: 6,
                    }}
                  />
                  outgoing
                </span>
              </div>
              {/* The tray's siblings are not on the canvas, so their coupling cannot be drawn as
                  a connector. It reuses the same two hover colours as a tile fill instead — and
                  a tile coupled both ways is split between them rather than given a third
                  colour, so there is nothing extra to learn. */}
              <div style={{ ...railLabelStyle, marginTop: 8 }}>Connected siblings</div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  font: "var(--text-xs)",
                  color: "var(--text-dim)",
                }}
              >
                {(
                  [
                    ["var(--temp-4)", "calls out to it"],
                    ["var(--cool-azure)", "called into by it"],
                    [
                      "linear-gradient(135deg, var(--temp-4) 0 50%, var(--cool-azure) 50% 100%)",
                      "both ways",
                    ],
                  ] as const
                ).map(([swatch, label]) => (
                  <span key={label}>
                    <span
                      style={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: swatch,
                        verticalAlign: "middle",
                        marginRight: 6,
                      }}
                    />
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}
          {showNav && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
              }}
            >
              <div style={railLabelStyle}>Navigating</div>
              <div
                style={{
                  font: "var(--text-xs)",
                  color: "var(--text-dim)",
                  lineHeight: 1.6,
                }}
              >
                Click a node to inspect it. Double-click (hex nodes) to open.
                Double-click empty canvas, or Zoom out above, to go back up.
              </div>
            </div>
          )}
        </div>
      </details>
    </>
  );
}

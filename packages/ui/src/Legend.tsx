import { GroupFrame } from "@scv/design-system";
import type { Unit } from "@scv/schema";
import { codedreamLayerPalette, hashLayerToColor } from "@scv/skin-tiles";

export type LegendProps = {
  units: Unit[];
};

/**
 * Group header rows (the architecture-level grouping) with their member layers nested
 * as sub-bullets underneath, each still colored the same way tiles are (hashed stable
 * layer id, CodeDream cool-accent palette). A layer with no group falls under a
 * catch-all "other" header.
 */
export function Legend({ units }: LegendProps): JSX.Element | null {
  const layers = units.filter((u) => u.kind === "layer");
  if (layers.length === 0) return null;

  const layersByGroup = new Map<string, Unit[]>();
  for (const layer of layers) {
    const group = layer.group ?? "other";
    (layersByGroup.get(group) ?? layersByGroup.set(group, []).get(group)!).push(layer);
  }

  return (
    <>
      {[...layersByGroup.entries()].map(([group, groupLayers]) => (
        <GroupFrame label={group} key={group}>
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
    </>
  );
}

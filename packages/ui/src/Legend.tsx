import type { Unit } from "@scv/schema";
import { hashLayerToColor } from "@scv/skin-tiles";

export type LegendProps = {
  units: Unit[];
};

/**
 * Group header rows (the architecture-level grouping) with their member layers nested
 * as sub-bullets underneath, each still colored the same way tiles are (hashed stable
 * layer id). A layer with no group falls under a catch-all "other" header.
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
        <div className="lg-group" key={group}>
          <div className="lg-group-header">{group}</div>
          {groupLayers.map((layer) => (
            <div className="lg" key={layer.id}>
              <span className="chip" style={{ background: hashLayerToColor(layer.id) }} />
              {layer.name}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

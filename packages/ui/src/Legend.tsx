import type { Unit } from "@scv/schema";
import { hashLayerToColor } from "@scv/skin-tiles";

export type LegendProps = {
  units: Unit[];
};

/** One chip per distinct semantic layer present in `units`, colored the same way tiles are (hashed stable layer id). */
export function Legend({ units }: LegendProps): JSX.Element | null {
  const layers = units.filter((u) => u.kind === "layer");
  if (layers.length === 0) return null;

  return (
    <>
      {layers.map((layer) => (
        <div className="lg" key={layer.id}>
          <span className="chip" style={{ background: hashLayerToColor(layer.id) }} />
          {layer.name}
        </div>
      ))}
    </>
  );
}

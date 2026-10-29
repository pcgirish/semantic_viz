import type { Theme } from "@semviz/skin-contract";

/** Default tiles theme. A skin may reinterpret the theme freely, never the encoding (docs/serve.md#6). */
export const defaultTheme: Theme = {
  ink: "#1a1a1a",
  slate: "#5b6472",
  hair: "#d8dce1",
  added: "#1f9d55",
  removed: "#d64545",
  modified: "#c98a1f",
  hi: "#d64545",
};

/**
 * Categorical hues for coloring tiles by semantic layer. Layer names are LLM-chosen and
 * not stable across re-analysis (packages/interpreter/src/orchestrate.ts), so tiles are
 * colored by hashing the layer's stable id, not its display name, into this palette.
 */
export const layerPalette: string[] = [
  "#3E7BC4", // edge
  "#1F9184", // domain
  "#7B5EA7", // infra
  "#B87D22", // support
  "#64728A", // ops
  "#AC4F76", // tests
  "#3E9B5C",
  "#C4573E",
  "#3E9BB8",
  "#8E8E3E",
];

/**
 * CodeDream cool-accent palette (tokens/colors.css --cool-*), for layer coloring in the
 * CodeDream-skinned UI. Same hashLayerToColor hashing, different color set (docs/plans/codedream-ui-migration.md decision 2).
 */
export const codedreamLayerPalette: string[] = [
  "#1FB6C1", // cyan
  "#2ED3A7", // mint
  "#3D7FFF", // azure
  "#5B6EE8", // indigo
  "#0E8F8F", // teal
  "#1F72E0", // blue
  "#3FAE4A", // green
];

/** Deterministic FNV-1a hash of a layer id into a palette color. Empty id -> empty string. */
export function hashLayerToColor(layerId: string, palette: string[] = layerPalette): string {
  if (!layerId) return "";
  let hash = 0x811c9dc5;
  for (let i = 0; i < layerId.length; i++) {
    hash ^= layerId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const index = (hash >>> 0) % palette.length;
  return palette[index]!;
}

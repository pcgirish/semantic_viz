/** The layout engine's sole output. Every skin consumes this; none computes its own. See docs/serve.md#1. */

export type SceneNode = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  sides: 3 | 4 | 6 | 0; // 0 = circle (13+ complexity bucket)
  heat: number;
  ring: boolean;
  // Display fields: a skin renders text from the Scene alone, never a raw Unit (docs/serve.md#1).
  name: string;
  sloc: number;
  fanIn: number;
  fanOut: number;
  layer: string; // nearest ancestor unit's stable id with kind "layer", or "" if none
  group: string; // nearest layer ancestor's group name, or "" if none
  complexity: number; // raw cyclomatic complexity, or 0 if unavailable
  // block units only (buildFlowchartScene) — blockType drives shape (decision/loop render
  // as a diamond regardless of `sides`); condition is the diamond's label text.
  blockType?: "entry" | "sequential" | "decision" | "loop" | "try" | "catch" | "exit" | "merge";
  condition?: string;
};

export type SceneRegion = {
  id: string; // group name, stable slug
  name: string; // group display name
  x: number;
  y: number;
  w: number;
  h: number;
};

export type EdgeKindState = "current" | "added" | "removed" | "reweighted";

export type SceneLink = {
  id: string;
  from: string;
  to: string;
  path: Array<{ x: number; y: number }>;
  lane: number;
  bundle: string[];
  kind: string;
  state: EdgeKindState;
  // control_flow links only (buildFlowchartScene) — which branch this edge represents,
  // so the skin can label true/false/loop-back at the link's midpoint.
  flowType?: "sequential" | "true" | "false" | "loop-back" | "exception";
};

export type Scene = {
  nodes: SceneNode[];
  links: SceneLink[];
  regions: SceneRegion[];
};

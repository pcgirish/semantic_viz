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
  /**
   * Present only on collapsed external endpoints — "boundary markers". Such a node stands for a
   * unit *outside* the focused subtree, so `Scene.nodes` is the one place units outside the focus
   * appear; a consumer that assumes otherwise must filter on `boundary === undefined`.
   *
   * `id` is the off-screen unit's own id, not a synthetic one, so drill, hover, search and
   * `data-id` all work with no new code. `direction` is `"both"` iff both counts are non-zero —
   * redundant with them by construction, so the common render path is a switch, not two
   * comparisons.
   */
  boundary?: {
    edgeCount: number; // total contributing edges, in + out
    weight: number; // summed contributor weight, in + out
    direction: "in" | "out" | "both";
    inCount: number; // contributing edges pointing into the focused subtree
    outCount: number; // ...and out of it; inCount + outCount === edgeCount
  };
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
  // Max weight among bundled edges (route.ts) — drives connector thickness in skins
  // (docs mock's heavy/weight fixture pairing).
  weight?: number;
  // control_flow links only (buildFlowchartScene) — which branch this edge represents,
  // so the skin can label true/false/loop-back at the link's midpoint.
  flowType?: "sequential" | "true" | "false" | "loop-back" | "exception";
};

export type Scene = {
  nodes: SceneNode[];
  links: SceneLink[];
  regions: SceneRegion[];
};

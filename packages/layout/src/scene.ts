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
};

export type Scene = {
  nodes: SceneNode[];
  links: SceneLink[];
};

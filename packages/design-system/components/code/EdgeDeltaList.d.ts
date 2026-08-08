import * as React from "react";

/** One relationship change: an edge added, removed or reweighted between commits/PRs. */
export interface EdgeDelta {
  id?: string;
  kind?: "added" | "removed" | "reweighted";
  from: string;
  to: string;
  /** prior/new weight (call count, coupling strength, …) — shown only when they differ */
  weightFrom?: number;
  weightTo?: number;
  /** trailing meta, e.g. a timestamp or PR number */
  meta?: React.ReactNode;
}

/**
 * Single relationship-change row: status glyph, from→to pair, optional weight delta.
 * @startingPoint section="Code" subtitle="Added / removed / reweighted edge row" viewport="700x120"
 */
export interface DeltaRowProps extends EdgeDelta {
  selected?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}
export declare function DeltaRow(props: DeltaRowProps): JSX.Element;

/** Stack of DeltaRows for a Tray — the edge-list counterpart to FileRow's file list. */
export interface EdgeDeltaListProps {
  edges: EdgeDelta[];
  /** selected edge id */
  selected?: string;
  onSelect?: (id: string) => void;
  style?: React.CSSProperties;
}
export declare function EdgeDeltaList(props: EdgeDeltaListProps): JSX.Element;

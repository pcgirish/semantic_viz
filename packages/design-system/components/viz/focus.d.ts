/**
 * Focus model for canvas highlighting. The design system owns the LOOK; the product owns
 * the traversal that produces the id sets.
 */
export interface FocusState {
  id: string | null;
  near?: string[];
  far?: string[];
  sticky?: boolean;
}

export declare const FOCUS_NONE: FocusState;

/** Focus state of one node id: "self" | "near" | "far" | "muted" | "none". */
export declare function focusRole(id: string | undefined, focus: FocusState | undefined): "self" | "near" | "far" | "muted" | "none";

/** Focus state of an edge given its endpoint ids. */
export declare function edgeRole(from: string, to: string, focus: FocusState | undefined): "near" | "far" | "muted" | "none";

/** Breadth-first neighbour sets from an edge list — the reference traversal. */
export declare function neighbours(
  id: string,
  edges: Array<{ from: string; to: string }>,
  depth?: number,
): { id: string; near: string[]; far: string[] };

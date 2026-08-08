import * as React from "react";

/**
 * Unified diff block with gutter-marked lines.
 * @startingPoint section="Code" subtitle="Unified diff hunk" viewport="700x260"
 */
export interface DiffLine{
  kind?:"add"|"del"|"mod"|"ctx";
  /** old-side line number */
  old?:number|string;
  /** new-side line number */
  new?:number|string;
  text:string;
}
export interface DiffHunkProps{
  path:string;
  /** e.g. "@@ -184,7 +184,12 @@" */
  range?:string;
  lines:DiffLine[];
  collapsed?:boolean;
  onToggle?:()=>void;
  style?:React.CSSProperties;
}
export declare function DiffHunk(props:DiffHunkProps):JSX.Element;

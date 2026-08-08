import * as React from "react";

/** Hover tooltip with mono content — used heavily on graph nodes. */
export interface TooltipProps{
  children:React.ReactNode;
  content:React.ReactNode;
  side?:"top"|"right"|"bottom";
  style?:React.CSSProperties;
}
export declare function Tooltip(props:TooltipProps):JSX.Element;

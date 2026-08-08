import * as React from "react";

/** Horizontal application bar with three clusters. */
export interface ToolbarProps{
  left?:React.ReactNode;
  center?:React.ReactNode;
  right?:React.ReactNode;
  /** 34px instead of 44px */
  dense?:boolean;
  style?:React.CSSProperties;
}
export declare function Toolbar(props:ToolbarProps):JSX.Element;

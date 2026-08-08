import * as React from "react";

/**
 * Collapsible information tray — CodeDream screens stack several of these per side.
 */
export interface TrayProps{
  title:React.ReactNode;
  icon?:string;
  meta?:React.ReactNode;
  /** header-right controls, usually IconButtons */
  actions?:React.ReactNode;
  children?:React.ReactNode;
  collapsible?:boolean;
  defaultOpen?:boolean;
  dock?:"left"|"right";
  width?:number|string;
  /** translucent + blurred, for trays over the canvas */
  floating?:boolean;
  style?:React.CSSProperties;
}
export declare function Tray(props:TrayProps):JSX.Element;

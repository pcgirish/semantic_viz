import * as React from "react";

/** Vertical icon rail for top-level tool navigation. */
export interface RailItem{value:string;icon:string;label:string}
export interface RailProps{
  items:RailItem[];
  value?:string;
  onChange?:(value:string)=>void;
  footer?:React.ReactNode;
  style?:React.CSSProperties;
}
export declare function Rail(props:RailProps):JSX.Element;

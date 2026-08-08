import * as React from "react";

/** Dense file row for trees and changed-file lists. */
export interface FileRowProps{
  name:string;
  /** dimmed trailing path or detail */
  path?:string;
  /** indent level */
  depth?:number;
  /** 0..7 temperature — drives the leading diamond */
  temp?:number;
  added?:number;
  removed?:number;
  /** churn series for the inline sparkline */
  churn?:number[];
  kind?:"file"|"dir";
  selected?:boolean;
  onClick?:()=>void;
  style?:React.CSSProperties;
}
export declare function FileRow(props:FileRowProps):JSX.Element;

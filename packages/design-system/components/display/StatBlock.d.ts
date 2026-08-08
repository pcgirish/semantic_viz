import * as React from "react";

/** Single metric: label, value, unit and delta. */
export interface StatBlockProps{
  label:string;
  value:React.ReactNode;
  unit?:string;
  /** e.g. "+18%" */
  delta?:string;
  deltaTone?:"cool"|"warm"|"risk"|"neutral";
  icon?:string;
  style?:React.CSSProperties;
}
export declare function StatBlock(props:StatBlockProps):JSX.Element;

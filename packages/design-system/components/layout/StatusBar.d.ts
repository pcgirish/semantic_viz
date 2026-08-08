import * as React from "react";

/** Bottom status strip. */
export interface StatusItem{label:React.ReactNode;icon?:string;tone?:string}
export interface StatusBarProps{
  items:StatusItem[];
  right?:React.ReactNode;
  style?:React.CSSProperties;
}
export declare function StatusBar(props:StatusBarProps):JSX.Element;

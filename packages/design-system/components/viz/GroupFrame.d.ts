import * as React from "react";

/** Dashed cluster indicator: package, layer, owner or feature boundary. */
export interface GroupFrameProps{
  label:React.ReactNode;
  /** trailing count/detail in the label chip */
  meta?:React.ReactNode;
  color?:string;
  icon?:string;
  children?:React.ReactNode;
  style?:React.CSSProperties;
}
export declare function GroupFrame(props:GroupFrameProps):JSX.Element;

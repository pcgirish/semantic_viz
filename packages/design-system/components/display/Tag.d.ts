import * as React from "react";

/** Arrow-shaped tag for owners, packages and labels. */
export interface TagProps{
  children?:React.ReactNode;
  /** hex or token for the leading hex marker */
  color?:string;
  icon?:string;
  onRemove?:()=>void;
  style?:React.CSSProperties;
}
export declare function Tag(props:TagProps):JSX.Element;

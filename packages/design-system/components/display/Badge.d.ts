import * as React from "react";

/** Small mono status badge, chamfered. */
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>{
  children?:React.ReactNode;
  tone?:"neutral"|"cool"|"flow"|"add"|"mod"|"del"|"risk";
  /** Lucide icon name */
  icon?:string;
  /** leading diamond dot instead of an icon */
  dot?:boolean;
}
export declare function Badge(props:BadgeProps):JSX.Element;

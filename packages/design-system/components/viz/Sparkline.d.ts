import * as React from "react";

/** Churn / activity micro-chart. */
export interface SparklineProps{
  values:number[];
  mode?:"bars"|"area";
  /** 0..7 temperature colour */
  temp?:number;
  width?:number;
  height?:number;
  style?:React.CSSProperties;
}
export declare function Sparkline(props:SparklineProps):JSX.Element;

import * as React from "react";

/** Temperature-scale legend; optionally acts as a filter. */
export interface HeatLegendProps{
  from?:string;
  to?:string;
  compact?:boolean;
  /** highlighted stop 0..7 */
  value?:number;
  onPick?:(stop:number)=>void;
  style?:React.CSSProperties;
}
export declare function HeatLegend(props:HeatLegendProps):JSX.Element;

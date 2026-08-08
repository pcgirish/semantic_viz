import * as React from "react";

/** Segmented risk readout on the 0..7 temperature scale. */
export interface RiskMeterProps{
  value?:number;
  segments?:number;
  label?:string;
  /** short mono reason lines under the meter */
  reasons?:string[];
  style?:React.CSSProperties;
}
export declare function RiskMeter(props:RiskMeterProps):JSX.Element;

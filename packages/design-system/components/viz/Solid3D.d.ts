import * as React from "react";

/**
 * CSS-3D extruded block for the 3D skin.
 */
export interface Solid3DProps{
  size?:number;
  /** extrusion depth in px */
  depth?:number;
  /** 0..7 temperature */
  temp?:number;
  label?:React.ReactNode;
  /** slow continuous rotation */
  spin?:boolean;
  /** apply the canonical camera tilt */
  tilt?:boolean;
  style?:React.CSSProperties;
}
export declare function Solid3D(props:Solid3DProps):JSX.Element;

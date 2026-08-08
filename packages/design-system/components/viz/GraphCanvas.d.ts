import * as React from "react";

/**
 * The canvas surface: grid, vignette, node/connector space and floating overlays.
 */
export interface GraphCanvasProps{
  children?:React.ReactNode;
  /** floating trays, legend, minimap — rendered above the node space */
  overlay?:React.ReactNode;
  grid?:boolean;
  /** "3d" tilts the grid into the isometric camera */
  skin?:"2d"|"3d";
  style?:React.CSSProperties;
}
export declare function GraphCanvas(props:GraphCanvasProps):JSX.Element;

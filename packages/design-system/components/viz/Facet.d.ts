import * as React from "react";

/**
 * Faceted shape drawn as SVG: rounded vertices, unbroken outline. Use anywhere a polygon
 * needs a stroke — a CSS border under clip-path loses every diagonal edge.
 */
export interface FacetProps extends React.HTMLAttributes<HTMLDivElement>{
  shape?:"chamfer"|"hex"|"hex-tall"|"diamond"|"triangle"|"tag"|"square"|"pill";
  width?:number;
  height?:number;
  /** vertex rounding radius in px (default 4; 2 for chips) */
  join?:number;
  /** chamfer/tag cut length in px (default 7) */
  cut?:number;
  stroke?:string;
  strokeWidth?:number;
  /** solid fill, or the first stop when fillTo is set */
  fill?:string;
  /** second gradient stop — lit from the --light-key direction */
  fillTo?:string;
  /** colour for a soft outer glow */
  glow?:string;
  children?:React.ReactNode;
}
export declare function Facet(props:FacetProps):JSX.Element;
/** Rounded-vertex path builder, exported for custom geometry. */
export declare function facetPath(points:[number,number][],r?:number):string;

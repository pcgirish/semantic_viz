import * as React from "react";

/**
 * Faceted canvas node representing a file, module, symbol or package.
 */
export interface PolyNodeProps extends React.HTMLAttributes<HTMLDivElement>{
  label:React.ReactNode;
  /** mono metric under the label, e.g. "+212 −44" */
  sublabel?:React.ReactNode;
  /** 0 dormant → 7 critical; drives fill, edge and glow */
  temp?:number;
  shape?:"hex"|"hex-tall"|"chamfer"|"diamond"|"square";
  /** px width (height follows for hex) */
  size?:number;
  icon?:string;
  selected?:boolean;
  /** solid filled face instead of the outlined treatment (also implied by selected) */
  filled?:boolean;
  /** fade out-of-focus nodes */
  dim?:boolean;
  /** node id — required for focus highlighting */
  id?:string;
  /** shared focus state: { id, near[], far[] } from the viz focus model */
  focus?:{id:string|null;near?:string[];far?:string[];sticky?:boolean};
  /** called with (id, "hover") on mouse-over — the product decides the traversal */
  onFocusNode?:(id:string,cause:"hover"|"click")=>void;
  /** px offset of the extruded back face (3D skin) */
  extrude?:number;
}
export declare function PolyNode(props:PolyNodeProps):JSX.Element;

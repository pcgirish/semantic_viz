import * as React from "react";

/** SVG layer of curved dependency connectors. Absolutely positioned inside a GraphCanvas. */
export interface ConnectorEdge{
  x1:number;y1:number;x2:number;y2:number;
  /**
   * import = hairline, call = accent, flow = animated dash, weak = dashed, risk = red,
   * control = 3 slow travelling dots (indigo), data = 5 fast travelling dots (cyan),
   * hover-in/hover-out = incoming/outgoing edge recolor while a node is hovered
   */
  kind?:"import"|"call"|"flow"|"weak"|"risk"|"control"|"data"|"hover-in"|"hover-out";
  label?:string;
  heavy?:boolean;
  dim?:boolean;
  directed?:boolean;
  /** endpoint node ids — enable focus highlighting */
  from?:string;
  to?:string;
  /** per-edge override of the layer's routing */
  route?:"curve"|"ortho"|"ortho-v";
  /** per-edge elbow radius in px */
  elbow?:number;
  /** per-edge stub length before the first turn */
  stub?:number;
}
export interface ConnectorLayerProps{
  edges:ConnectorEdge[];
  width?:number|string;
  height?:number|string;
  arrows?:boolean;
  /** shared focus state: edges touching focus.id brighten, unrelated edges dim */
  focus?:{id:string|null;near?:string[];far?:string[];sticky?:boolean};
  /** curve = single bezier (default); ortho = Manhattan route with rounded elbows; ortho-v = fixed vertical-port Manhattan route */
  route?:"curve"|"ortho"|"ortho-v";
  /** elbow corner radius in px for ortho routing (default 10) */
  elbow?:number;
  /** stub length in px before the first turn on vertical-first ortho routes (default 14) */
  stub?:number;
  style?:React.CSSProperties;
}
export declare function ConnectorLayer(props:ConnectorLayerProps):JSX.Element;

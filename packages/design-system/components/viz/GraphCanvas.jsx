import React from "react";

/** Grid canvas surface with vignette and optional floating overlays (legend, minimap, trays). */
export function GraphCanvas({children,overlay,grid=true,skin="2d",style}){
  return (
    <div style={{position:"relative",flex:1,minWidth:0,minHeight:0,overflow:"hidden",background:"var(--canvas)",...style}}>
      {grid&&<div className="cd-grid-bg" style={{position:"absolute",inset:0,backgroundSize:"var(--grid-cell) var(--grid-cell)",opacity:skin==="3d"?.5:1,transform:skin==="3d"?"perspective(900px) rotateX(46deg) scale(1.6)":"none",transformOrigin:"50% 100%"}}/>}
      <div style={{position:"absolute",inset:0,background:"radial-gradient(120% 90% at 50% 40%,transparent 40%,rgba(6,9,13,.65) 100%)",pointerEvents:"none"}}/>
      <div style={{position:"absolute",inset:0}}>{children}</div>
      {overlay}
    </div>
  );
}

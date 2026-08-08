import React from "react";

/** Horizontal bar: left cluster, flexible middle, right cluster. */
export function Toolbar({left,center,right,dense,style}){
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,height:dense?34:"var(--bar-h)",padding:"0 12px",background:"var(--surface-0)",borderBottom:"var(--border-w) solid var(--border-hair)",...style}}>
      <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>{left}</div>
      <div style={{flex:1,display:"flex",justifyContent:"center",minWidth:0}}>{center}</div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>{right}</div>
    </div>
  );
}

import React from "react";
import { Icon } from "../core/Icon.jsx";

/** Bottom status strip: repo, ref, indexing state, legend hooks. */
export function StatusBar({items=[],right,style}){
  return (
    <div style={{display:"flex",alignItems:"center",gap:16,height:24,padding:"0 12px",background:"var(--surface-0)",borderTop:"var(--border-w) solid var(--border-hair)",font:"var(--type-metric)",color:"var(--text-faint)",...style}}>
      {items.map((it,i)=>(
        <span key={i} style={{display:"inline-flex",alignItems:"center",gap:5,color:it.tone||"inherit"}}>
          {it.icon&&<Icon name={it.icon} size={11}/>}{it.label}
        </span>
      ))}
      <span style={{flex:1}}/>
      {right}
    </div>
  );
}

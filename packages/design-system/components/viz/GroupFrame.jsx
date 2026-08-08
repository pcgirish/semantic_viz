import React from "react";
import { Icon } from "../core/Icon.jsx";

/** Dashed group indicator around a cluster of nodes: package, layer, owner or feature. */
export function GroupFrame({label,meta,color="var(--group-stroke)",icon,children,style}){
  return (
    <div style={{position:"relative",padding:"18px 14px 14px",border:`var(--border-w) dashed ${color}`,background:"var(--group-fill)",borderRadius:"var(--group-radius)",...style}}>
      <span style={{top:-9,left:12,display:"inline-flex",alignItems:"center",gap:5,padding:"1px 7px",background:color,clipPath:"var(--clip-chamfer-sm)",font:"var(--type-metric)",textTransform:"uppercase",letterSpacing:"var(--tracking-caps)",color:"var(--group-label)",position:"absolute"}}>
        <span aria-hidden="true" style={{position:"absolute",inset:1,clipPath:"var(--clip-chamfer-sm)",background:"var(--surface-0)"}}/>
        {icon&&<Icon name={icon} size={10} style={{position:"relative"}}/>}<span style={{position:"relative"}}>{label}</span>{meta&&<span style={{position:"relative",color:"var(--text-faint)"}}>· {meta}</span>}
      </span>
      {children}
    </div>
  );
}

import React from "react";
import { Icon } from "../core/Icon.jsx";

/** Arrow-shaped tag for owners, packages, labels. Removable. */
export function Tag({children,color="var(--cool-indigo)",icon,onRemove,style}){
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:6,height:21,padding:"0 14px 0 8px",background:"var(--surface-3)",color:"var(--text-body)",clipPath:"var(--clip-tag)",font:"var(--type-label)",...style}}>
      <span style={{width:6,height:6,background:color,clipPath:"var(--clip-hex-tall)"}}/>
      {icon&&<Icon name={icon} size={11}/>}
      {children}
      {onRemove&&<span onClick={onRemove} style={{cursor:"pointer",display:"inline-flex",color:"var(--text-faint)"}}><Icon name="x" size={10}/></span>}
    </span>
  );
}

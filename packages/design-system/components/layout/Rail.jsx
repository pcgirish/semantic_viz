import React from "react";
import { IconButton } from "../core/IconButton.jsx";

/** Vertical icon rail — top-level navigation between CodeDream tools. */
export function Rail({items=[],value,onChange,footer,style}){
  return (
    <nav style={{width:"var(--rail-w)",display:"flex",flexDirection:"column",alignItems:"center",gap:4,padding:"10px 0",background:"var(--surface-0)",borderRight:"var(--border-w) solid var(--border-hair)",...style}}>
      {items.map(it=>(
        <IconButton key={it.value} name={it.icon} label={it.label} size="lg" active={it.value===value} onClick={()=>onChange&&onChange(it.value)}/>
      ))}
      <span style={{flex:1}}/>
      {footer}
    </nav>
  );
}

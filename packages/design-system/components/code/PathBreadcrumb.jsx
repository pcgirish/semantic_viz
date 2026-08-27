import React from "react";
import { Icon } from "../core/Icon.jsx";

/** Repo / ref / path breadcrumb in mono type. */
export function PathBreadcrumb({segments=[],onPick,style}){
  return (
    <nav style={{display:"flex",alignItems:"center",gap:4,minWidth:0,font:"var(--type-code)",...style}}>
      {segments.map((s,i)=>(
        <React.Fragment key={i}>
          {i>0&&<Icon name="chevron-right" size={12} style={{background:"var(--text-faint)"}}/>}
          <span title={s.title} onClick={()=>onPick&&onPick(i)} style={{color:i===segments.length-1?"var(--text-hi)":"var(--text-dim)",cursor:onPick?"pointer":"default",whiteSpace:"nowrap"}}>
            {s.icon&&<Icon name={s.icon} size={12} style={{background:"var(--accent-lift)",marginRight:5,verticalAlign:"-2px"}}/>}
            {s.label}
          </span>
        </React.Fragment>
      ))}
    </nav>
  );
}

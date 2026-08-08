import React from "react";
import { Icon } from "../core/Icon.jsx";

/** One number, its label and an optional delta. Used across trays and dashboards. */
export function StatBlock({label,value,unit,delta,deltaTone="cool",icon,style}){
  const dc={cool:"var(--cool-mint)",warm:"var(--temp-4)",risk:"var(--temp-6)",neutral:"var(--text-faint)"}[deltaTone];
  return (
    <div style={{display:"grid",gap:4,...style}}>
      <span className="cd-mono-caps" style={{display:"inline-flex",alignItems:"center",gap:5}}>{icon&&<Icon name={icon} size={11}/>}{label}</span>
      <span style={{display:"flex",alignItems:"baseline",gap:6}}>
        <span style={{font:"var(--weight-bold) var(--text-2xl)/1 var(--font-core)",color:"var(--text-hi)",letterSpacing:"var(--tracking-tight)",fontVariantNumeric:"tabular-nums"}}>{value}</span>
        {unit&&<span style={{font:"var(--type-metric)",color:"var(--text-faint)"}}>{unit}</span>}
        {delta&&<span style={{font:"var(--type-metric)",color:dc}}>{delta}</span>}
      </span>
    </div>
  );
}

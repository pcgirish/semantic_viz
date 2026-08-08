import React from "react";
import { tempHex } from "./temp.js";

/** Segmented risk readout, 0..7 on the temperature scale. */
export function RiskMeter({value=0,segments=7,label="risk",reasons,style}){
  const c=tempHex(value);
  return (
    <div style={{display:"grid",gap:6,...style}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <span className="cd-mono-caps">{label}</span>
        <span style={{font:"var(--type-metric)",color:c}}>{value}/{segments}</span>
      </div>
      <div style={{display:"flex",gap:3}}>
        {Array.from({length:segments}).map((_,i)=>(
          <span key={i} style={{flex:1,height:6,background:i<value?c:"var(--ink-750)",clipPath:"var(--clip-chamfer-sm)",transition:"background var(--t-temp)"}}/>
        ))}
      </div>
      {reasons&&<ul style={{margin:0,padding:0,listStyle:"none",display:"grid",gap:3,font:"var(--type-metric)",color:"var(--text-dim)"}}>
        {reasons.map((r,i)=><li key={i}>· {r}</li>)}
      </ul>}
    </div>
  );
}

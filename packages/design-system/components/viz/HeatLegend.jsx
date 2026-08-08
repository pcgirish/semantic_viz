import React from "react";
import { TEMP_STOPS } from "./temp.js";

/** The temperature scale, shown wherever heat colouring is active. */
export function HeatLegend({from="dormant",to="critical",compact,value,onPick,style}){
  return (
    <div style={{display:"grid",gap:6,...style}}>
      <div style={{display:"flex",gap:2}}>
        {TEMP_STOPS.map(s=>(
          <button key={s.key} type="button" onClick={()=>onPick&&onPick(s.key)} title={s.label}
            style={{flex:1,height:compact?8:14,background:s.token,border:"none",outline:value===s.key?"1px solid var(--text-hi)":"none",outlineOffset:1,clipPath:"var(--clip-chamfer-sm)",cursor:onPick?"pointer":"default",padding:0}}/>
        ))}
      </div>
      <div style={{display:"flex",justifyContent:"space-between",font:"var(--type-metric)",color:"var(--text-faint)",textTransform:"uppercase",letterSpacing:"var(--tracking-caps)"}}>
        <span>{from}</span><span>{to}</span>
      </div>
    </div>
  );
}

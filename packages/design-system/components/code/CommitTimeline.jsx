import React from "react";
import { tempHex } from "../viz/temp.js";

/** Horizontal commit scrubber — the time axis for every CodeDream view. */
export function CommitTimeline({commits=[],value,onChange,height=48,style}){
  return (
    <div style={{position:"relative",height,padding:"0 4px",display:"flex",alignItems:"flex-end",gap:3,background:"var(--surface-0)",borderTop:"var(--border-w) solid var(--border-hair)",...style}}>
      <span style={{position:"absolute",left:0,right:0,bottom:14,height:1,background:"var(--border-hair)"}}/>
      {commits.map((c,i)=>{
        const on=i===value;
        const col=tempHex(c.temp??1);
        const h=8+Math.min(24,(c.churn||1)/6);
        return (
          <button key={c.sha||i} type="button" onClick={()=>onChange&&onChange(i)} title={`${c.sha} · ${c.message||""}`}
            style={{position:"relative",flex:1,minWidth:3,height:h+14,padding:0,background:"transparent",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",justifyContent:"flex-end",alignItems:"center",gap:4}}>
            <span style={{width:"100%",height:h,background:col,opacity:on?1:.55,transition:"opacity var(--t-hover)"}}/>
            <span style={{width:on?7:5,height:on?7:5,background:on?"var(--text-hi)":col,clipPath:"var(--clip-diamond)"}}/>
          </button>
        );
      })}
    </div>
  );
}

import React from "react";

const KIND={add:["var(--diff-add-bg)","var(--diff-add-gutter)","+"],del:["var(--diff-del-bg)","var(--diff-del-gutter)","−"],mod:["var(--diff-mod-bg)","var(--diff-mod-gutter)","~"],ctx:["transparent","transparent"," "]};

/** Unified diff block: header + gutter-marked lines. */
export function DiffHunk({path,range,lines=[],collapsed,onToggle,style}){
  return (
    <div style={{border:"var(--border-w) solid var(--border-hair)",borderRadius:"var(--radius-sm)",overflow:"hidden",background:"var(--surface-0)",...style}}>
      <header onClick={onToggle} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 10px",background:"var(--surface-2)",borderBottom:collapsed?"none":"var(--border-w) solid var(--border-hair)",cursor:onToggle?"pointer":"default"}}>
        <span style={{font:"var(--type-code)",fontWeight:"var(--weight-medium)",color:"var(--text-hi)"}}>{path}</span>
        {range&&<span style={{font:"var(--type-metric)",color:"var(--text-faint)"}}>{range}</span>}
      </header>
      {!collapsed&&(
        <div style={{font:"var(--type-code)"}}>
          {lines.map((l,i)=>{
            const [bg,gut,sign]=KIND[l.kind||"ctx"]||KIND.ctx;
            return (
              <div key={i} style={{display:"grid",gridTemplateColumns:"44px 44px 8px 1fr",alignItems:"baseline",background:bg}}>
                <span style={{textAlign:"right",padding:"0 8px",color:"var(--text-faint)",font:"var(--type-metric)"}}>{l.old??""}</span>
                <span style={{textAlign:"right",padding:"0 8px",color:"var(--text-faint)",font:"var(--type-metric)",borderRight:`2px solid ${gut}`}}>{l.new??""}</span>
                <span style={{textAlign:"center",color:gut==="transparent"?"var(--text-faint)":gut}}>{sign}</span>
                <span style={{whiteSpace:"pre",overflow:"hidden",textOverflow:"ellipsis",color:l.kind==="ctx"?"var(--text-dim)":"var(--text-hi)",paddingRight:10}}>{l.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

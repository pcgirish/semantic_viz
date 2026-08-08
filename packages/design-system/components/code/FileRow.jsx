import React from "react";
import { Icon } from "../core/Icon.jsx";
import { tempHex } from "../viz/temp.js";
import { Sparkline } from "../viz/Sparkline.jsx";

/** Dense file/tree row with heat marker, diff counts and optional churn sparkline. */
export function FileRow({name,path,depth=0,temp=1,added,removed,churn,kind="file",selected,onClick,style}){
  const c=tempHex(temp);
  return (
    <div onClick={onClick} style={{display:"flex",alignItems:"center",gap:8,height:"var(--row-h)",paddingLeft:8+depth*14,paddingRight:8,
      background:selected?"var(--surface-selected)":"transparent",borderLeft:`2px solid ${selected?"var(--accent)":"transparent"}`,
      cursor:onClick?"pointer":"default",transition:"background var(--t-hover)",...style}}
      onMouseEnter={e=>{if(!selected)e.currentTarget.style.background="var(--surface-hover)";}}
      onMouseLeave={e=>{if(!selected)e.currentTarget.style.background="transparent";}}>
      <span style={{width:6,height:6,background:c,clipPath:"var(--clip-diamond)",flex:"0 0 auto"}}/>
      <Icon name={kind==="dir"?"folder":"file-code"} size={13} style={{background:"var(--text-faint)"}}/>
      <span style={{flex:1,minWidth:0,font:"var(--type-code)",color:"var(--text-body)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
        {name}{path&&<span style={{color:"var(--text-faint)"}}> {path}</span>}
      </span>
      {churn&&<Sparkline values={churn} temp={temp} width={54} height={14}/>}
      {added!=null&&<span style={{font:"var(--type-metric)",color:"var(--diff-add)"}}>+{added}</span>}
      {removed!=null&&<span style={{font:"var(--type-metric)",color:"var(--diff-del)"}}>−{removed}</span>}
    </div>
  );
}

import React from "react";
import { Icon } from "../core/Icon.jsx";

const TONES={neutral:["var(--ink-750)","var(--text-dim)","var(--border-1)"],cool:["rgba(31,182,193,.14)","var(--cool-cyan-lift)","rgba(31,182,193,.4)"],flow:["rgba(61,127,255,.14)","var(--cool-azure-lift)","rgba(61,127,255,.4)"],add:["var(--diff-add-bg)","var(--diff-add)","rgba(46,211,167,.4)"],mod:["var(--diff-mod-bg)","var(--diff-mod)","rgba(242,169,59,.42)"],del:["var(--diff-del-bg)","var(--diff-del)","rgba(232,67,79,.42)"],risk:["rgba(232,67,79,.16)","#FF8189","rgba(232,67,79,.5)"]};

/** Small status/meta badge. Mono type, chamfered. */
export function Badge({children,tone="neutral",icon,dot,style,...rest}){
  const [bg,fg,bd]=TONES[tone]||TONES.neutral;
  // Outer layer is the stroke, inset child carries the fill: a CSS border would be clipped
  // away on the chamfer edge.
  return (
    <span style={{position:"relative",display:"inline-flex",alignItems:"center",gap:5,height:19,padding:"0 7px",background:bd,color:fg,clipPath:"var(--clip-chamfer-sm)",font:"var(--type-metric)",textTransform:"uppercase",letterSpacing:"var(--tracking-caps)",whiteSpace:"nowrap",...style}} {...rest}>
      <span aria-hidden="true" style={{position:"absolute",inset:1,clipPath:"var(--clip-chamfer-sm)",background:`linear-gradient(${bg},${bg}), var(--surface-1)`,zIndex:0}}/>
      {dot&&<span style={{position:"relative",width:5,height:5,background:fg,clipPath:"var(--clip-diamond)"}}/>}
      {icon&&<Icon name={icon} size={11} style={{position:"relative"}}/>}
      <span style={{position:"relative"}}>{children}</span>
    </span>
  );
}

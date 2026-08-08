import React from "react";

/** Hover tooltip. Dark tray surface, mono meta lines. */
export function Tooltip({children,content,side="top",style}){
  const [on,setOn]=React.useState(false);
  const pos=side==="top"?{bottom:"calc(100% + 6px)",left:"50%",transform:"translateX(-50%)"}:side==="right"?{left:"calc(100% + 6px)",top:"50%",transform:"translateY(-50%)"}:{top:"calc(100% + 6px)",left:"50%",transform:"translateX(-50%)"};
  return (
    <span style={{position:"relative",display:"inline-flex",...style}} onMouseEnter={()=>setOn(true)} onMouseLeave={()=>setOn(false)}>
      {children}
      {on&&(
        <span style={{position:"absolute",zIndex:40,...pos,padding:"6px 9px",maxWidth:260,background:"var(--ink-1000)",border:"var(--border-w) solid var(--border-1)",borderRadius:"var(--radius-xs)",boxShadow:"var(--shadow-3)",font:"var(--type-code)",color:"var(--text-body)",whiteSpace:"pre-line",animation:"cd-rise var(--dur-2) var(--ease-out-geo)"}}>{content}</span>
      )}
    </span>
  );
}

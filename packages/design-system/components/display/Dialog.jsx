import React from "react";
import { IconButton } from "../core/IconButton.jsx";

/** Centered modal over a scrim. */
export function Dialog({open,onClose,title,meta,children,footer,width=520}){
  if(!open) return null;
  return (
    <div style={{position:"fixed",inset:0,zIndex:60,display:"grid",placeItems:"center",background:"var(--scrim)",backdropFilter:"blur(2px)"}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{width,maxWidth:"92vw",background:"var(--surface-1)",border:"var(--border-w) solid var(--border-2)",borderRadius:"var(--radius-lg)",boxShadow:"var(--shadow-4)",animation:"cd-rise var(--dur-3) var(--ease-out-geo)"}}>
        <header style={{display:"flex",alignItems:"center",gap:12,padding:"12px 12px 12px 16px",borderBottom:"var(--border-w) solid var(--border-hair)"}}>
          <h3 style={{flex:1,font:"var(--type-h3)"}}>{title}</h3>
          {meta&&<span className="cd-mono-caps">{meta}</span>}
          <IconButton name="x" label="Close" onClick={onClose}/>
        </header>
        <div style={{padding:"16px"}}>{children}</div>
        {footer&&<footer style={{display:"flex",justifyContent:"flex-end",gap:8,padding:"12px 16px",borderTop:"var(--border-w) solid var(--border-hair)"}}>{footer}</footer>}
      </div>
    </div>
  );
}

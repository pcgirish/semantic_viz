import React from "react";
import { Icon } from "../core/Icon.jsx";
import { IconButton } from "../core/IconButton.jsx";

/** A tray: the unit of information density in CodeDream. Collapsible, dockable panel. */
export function Tray({title,icon,meta,actions,children,collapsible=true,defaultOpen=true,dock="left",width,floating,style}){
  const [open,setOpen]=React.useState(defaultOpen);
  return (
    <section style={{display:"flex",flexDirection:"column",minHeight:0,width:width||"var(--tray-w)",background:floating?"var(--surface-tray)":"var(--surface-1)",backdropFilter:floating?"var(--blur-tray)":undefined,border:"var(--border-w) solid var(--border-hair)",borderRadius:"var(--radius-tray)",boxShadow:floating?"var(--shadow-tray)":"none",overflow:"hidden",...style}}>
      <header onClick={()=>collapsible&&setOpen(o=>!o)} style={{display:"flex",alignItems:"center",gap:8,height:32,padding:"0 8px 0 10px",background:"var(--surface-2)",borderBottom:open?"var(--border-w) solid var(--border-hair)":"none",cursor:collapsible?"pointer":"default",flex:"0 0 auto"}}>
        {collapsible&&<Icon name={open?"chevron-down":"chevron-right"} size={13} style={{background:"var(--text-faint)"}}/>}
        {icon&&<Icon name={icon} size={13} style={{background:"var(--accent-lift)"}}/>}
        <span style={{flex:1,font:"var(--type-label)",textTransform:"uppercase",letterSpacing:"var(--tracking-caps)",color:"var(--text-dim)"}}>{title}</span>
        {meta&&<span style={{font:"var(--type-metric)",color:"var(--text-faint)"}}>{meta}</span>}
        {actions}
      </header>
      {open&&<div style={{flex:1,minHeight:0,overflow:"auto",padding:"var(--gutter-tray)"}}>{children}</div>}
    </section>
  );
}
export { IconButton as TrayAction };

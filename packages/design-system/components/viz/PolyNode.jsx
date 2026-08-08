import React from "react";
import { tempHex } from "./temp.js";
import { Icon } from "../core/Icon.jsx";
import { focusRole } from "./focus.js";
import { Facet } from "./Facet.jsx";

const SHAPES={hex:"hex",chamfer:"chamfer",diamond:"diamond",square:"square","hex-tall":"hex-tall",pill:"pill"};

/**
 * A codebase object on the canvas: file, module, symbol or package.
 * Faceted polygon with rounded vertices, temperature-tinted, optionally extruded for the 3D skin.
 */
export function PolyNode({
  label,sublabel,temp=1,color,shape="chamfer",size=88,height,icon,selected,dim,focus,id,
  filled,extrude=0,onClick,onFocusNode,style,...rest
}){
  const c=color||tempHex(temp);
  const role=focusRole(id,focus);
  const isSelected=selected||role==="self";
  const isDim=dim||role==="muted";
  const s=SHAPES[shape]||"chamfer";
  const h=height??(shape==="hex"?Math.round(size*0.88):size);
  const solid=filled||isSelected;
  return (
    <div onClick={onClick} onMouseOver={onFocusNode?()=>onFocusNode(id,"hover"):undefined}
      style={{position:"relative",width:size,height:h,cursor:onClick?"pointer":"default",
        opacity:isDim?"var(--focus-dim)":1,
        transition:"opacity var(--t-node),transform var(--t-node)",...style}} {...rest}
      onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";}}
      onMouseLeave={e=>{e.currentTarget.style.transform="none";}}>
      {extrude>0&&(
        <Facet shape={s} width={size} height={h} stroke="none" fill="var(--geo-ao)"
          style={{position:"absolute",left:extrude,top:extrude}}/>
      )}
      <Facet shape={s} width={size} height={h}
        stroke={solid?"none":isSelected?c:role==="near"?c+"cc":c+"88"}
        fill={solid?c:c+"3d"} fillTo={solid?c+"66":c+"12"}
        glow={isSelected?c+"aa":role==="near"?c+"66":undefined}
        style={{position:"absolute",inset:0}}>
        {icon&&<Icon name={icon} size={14} strokeTint={solid?"var(--text-hi)":c}/>}
        <span style={{font:"var(--weight-semibold) var(--text-2xs)/1.15 var(--font-mono)",color:"var(--text-hi)",wordBreak:"break-word"}}>{label}</span>
        {sublabel&&<span style={{font:"var(--type-metric)",color:solid?"var(--text-hi)":c}}>{sublabel}</span>}
      </Facet>
    </div>
  );
}

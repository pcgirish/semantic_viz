import React from "react";
import { tempHex } from "./temp.js";

/**
 * CSS-3D polyhedron block — the 3D skin's primitive.
 * Same palette and light rig as the flat canvas, so skins stay consistent.
 */
export function Solid3D({size=96,depth=24,temp=1,label,spin=false,tilt=true,style}){
  const c=tempHex(temp);
  const S=size,D=depth,off=(S-D)/2;
  const base={position:"absolute",border:`1px solid ${c}`,backfaceVisibility:"hidden"};
  return (
    <div style={{width:S,height:S,perspective:"var(--persp)",...style}}>
      <div style={{position:"relative",width:"100%",height:"100%",transformStyle:"preserve-3d",
        transform:tilt?"rotateX(-22deg) rotateY(28deg)":"none",
        animation:spin?"cd-spin var(--dur-6) linear infinite":undefined,
        transition:"transform var(--t-node)"}}>
        <div style={{...base,left:0,top:0,width:S,height:S,background:`linear-gradient(var(--light-key),${c}66,${c}22)`,transform:`translateZ(${D/2}px)`,display:"grid",placeItems:"center"}}>
          {label&&<span style={{font:"var(--weight-semibold) var(--text-2xs)/1 var(--font-mono)",color:"var(--text-hi)"}}>{label}</span>}
        </div>
        <div style={{...base,left:0,top:0,width:S,height:S,background:`linear-gradient(var(--light-key),${c}2a,${c}0d)`,transform:`rotateY(180deg) translateZ(${D/2}px)`}}/>
        <div style={{...base,left:off,top:0,width:D,height:S,background:`linear-gradient(180deg,${c}44,${c}14)`,transform:`rotateY(90deg) translateZ(${S/2}px)`}}/>
        <div style={{...base,left:off,top:0,width:D,height:S,background:`linear-gradient(180deg,${c}30,${c}10)`,transform:`rotateY(-90deg) translateZ(${S/2}px)`}}/>
        <div style={{...base,left:0,top:off,width:S,height:D,background:`linear-gradient(90deg,${c}55,${c}1e)`,transform:`rotateX(90deg) translateZ(${S/2}px)`}}/>
        <div style={{...base,left:0,top:off,width:S,height:D,background:"var(--geo-ao)",transform:`rotateX(-90deg) translateZ(${S/2}px)`}}/>
      </div>
    </div>
  );
}

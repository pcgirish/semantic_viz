import React from "react";
import { tempHex } from "./temp.js";

/** Churn / activity micro-chart. Bars for commits, area for cumulative lines. */
export function Sparkline({values=[],mode="bars",temp=2,width=120,height=28,style}){
  const max=Math.max(1,...values);
  const c=tempHex(temp);
  if(mode==="bars"){
    const w=Math.max(1,width/values.length-1.5);
    return (
      <svg width={width} height={height} style={style}>
        {values.map((v,i)=>{
          const h=Math.max(1,(v/max)*height);
          return <rect key={i} x={i*(w+1.5)} y={height-h} width={w} height={h} fill={c} opacity={.35+.65*(v/max)}/>;
        })}
      </svg>
    );
  }
  const pts=values.map((v,i)=>`${(i/(values.length-1||1))*width},${height-(v/max)*height}`).join(" ");
  return (
    <svg width={width} height={height} style={style}>
      <polyline points={pts} fill="none" stroke={c} strokeWidth="1.5"/>
      <polygon points={`0,${height} ${pts} ${width},${height}`} fill={c} opacity=".14"/>
    </svg>
  );
}

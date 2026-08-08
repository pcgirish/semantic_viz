import React from "react";

/** Unit-space vertices per shape. Chamfer/tag cuts are px, so they take the box size. */
function points(shape,w,h,cut=7){
  switch(shape){
    case "hex": return [[.25*w,0],[.75*w,0],[w,.5*h],[.75*w,h],[.25*w,h],[0,.5*h]];
    case "hex-tall": return [[.5*w,0],[w,.25*h],[w,.75*h],[.5*w,h],[0,.75*h],[0,.25*h]];
    case "diamond": return [[.5*w,0],[w,.5*h],[.5*w,h],[0,.5*h]];
    case "triangle": return [[.5*w,0],[w,h],[0,h]];
    case "tag": return [[0,0],[w-9,0],[w,.5*h],[w-9,h],[0,h]];
    case "square": return [[0,0],[w,0],[w,h],[0,h]];
    default: return [[cut,0],[w,0],[w,h-cut],[w-cut,h],[0,h],[0,cut]];
  }
}

/** Polygon path with rounded vertices — quadratic joins trimmed r back along each edge. */
export function facetPath(pts,r=4){
  const n=pts.length,out=[];
  const lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
  const dist=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
  for(let i=0;i<n;i++){
    const prev=pts[(i-1+n)%n],cur=pts[i],next=pts[(i+1)%n];
    const rIn=Math.min(r,dist(prev,cur)/2),rOut=Math.min(r,dist(cur,next)/2);
    const a=lerp(cur,prev,rIn/dist(prev,cur)||0),b=lerp(cur,next,rOut/dist(cur,next)||0);
    out.push(`${i===0?"M":"L"} ${a[0].toFixed(2)} ${a[1].toFixed(2)}`);
    out.push(`Q ${cur[0].toFixed(2)} ${cur[1].toFixed(2)} ${b[0].toFixed(2)} ${b[1].toFixed(2)}`);
  }
  return out.join(" ")+" Z";
}

/**
 * Faceted shape drawn as SVG so vertices round cleanly and the outline never breaks.
 * A CSS border under clip-path is cut away on every diagonal edge — use this instead.
 * Children render above the shape, centred.
 */
export function Facet({
  shape="chamfer",width=88,height=88,join=4,cut=7,
  stroke="var(--border-1)",strokeWidth=1,fill="none",fillTo,
  glow,children,style,...rest
}){
  const gid=React.useId().replace(/[^a-zA-Z0-9]/g,"");
  const pad=strokeWidth/2;
  const pts=points(shape,width-strokeWidth,height-strokeWidth,cut).map(([x,y])=>[x+pad,y+pad]);
  return (
    <div style={{position:"relative",width,height,...style}} {...rest}>
      <svg width={width} height={height} style={{position:"absolute",inset:0,overflow:"visible",filter:glow?`drop-shadow(0 0 6px ${glow})`:undefined}}>
        {fillTo&&(
          <defs>
            <linearGradient id={`f${gid}`} x1="0" y1="0" x2="0.6" y2="1">
              <stop offset="0" stopColor={fill}/><stop offset="1" stopColor={fillTo}/>
            </linearGradient>
          </defs>
        )}
        <path d={facetPath(pts,join)} fill={fillTo?`url(#f${gid})`:fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round"/>
      </svg>
      {children!=null&&(
        <div style={{position:"absolute",inset:0,display:"grid",placeItems:"center",gap:2,padding:8,textAlign:"center"}}>{children}</div>
      )}
    </div>
  );
}

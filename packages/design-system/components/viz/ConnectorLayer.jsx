import React from "react";
import { edgeRole } from "./focus.js";

const KIND={
  import:{stroke:"var(--connector)",dash:null},
  call:{stroke:"var(--connector-active)",dash:null},
  flow:{stroke:"var(--connector-flow)",dash:"6 6",flow:true},
  weak:{stroke:"var(--connector)",dash:"4 4"},
  risk:{stroke:"var(--temp-6)",dash:null},
  // Hover-trace recolor (docs mock's bindHoverTrace): edges into the hovered node vs
  // edges out of it get distinct colors, independent of the edge's own call/import kind.
  "hover-in":{stroke:"var(--cool-azure)",dash:null},
  "hover-out":{stroke:"var(--temp-4)",dash:null},
  control:{stroke:"rgba(91,110,232,.45)",dash:null,dots:{fill:"var(--cool-indigo-lift)",r:3,count:3,dur:2.4}},
  data:{stroke:"rgba(31,182,193,.4)",dash:null,dots:{fill:"var(--cool-cyan-lift)",r:2.5,count:5,dur:1.8}}
};

/**
 * Manhattan path with rounded elbows. Routes horizontal-first through the mid-x when the
 * endpoints are far enough apart, vertical-first through the mid-y when they sit in the same
 * column, and adds a short stub so the path leaves the node face cleanly.
 */
function orthoPath(x1,y1,x2,y2,radius=10,stub=14){
  const dx=x2-x1,dy=y2-y1,sx=Math.sign(dx)||1,sy=Math.sign(dy)||1;
  if(Math.abs(dy)<2) return `M ${x1} ${y1} H ${x2}`;
  if(Math.abs(dx)<2) return `M ${x1} ${y1} V ${y2}`;
  if(Math.abs(dx)>=Math.abs(dy)){
    const mx=x1+dx/2, r=Math.max(2,Math.min(radius,Math.abs(mx-x1),Math.abs(x2-mx),Math.abs(dy)/2));
    return `M ${x1} ${y1} H ${mx-r*sx} Q ${mx} ${y1} ${mx} ${y1+r*sy} V ${y2-r*sy} Q ${mx} ${y2} ${mx+r*sx} ${y2} H ${x2}`;
  }
  const sx1=x1+stub*sx, my=y1+dy/2;
  const r=Math.max(2,Math.min(radius,Math.abs(my-y1),Math.abs(y2-my),Math.abs(x2-sx1)/2||radius));
  return `M ${x1} ${y1} H ${sx1} V ${my-r*sy} Q ${sx1} ${my} ${sx1+r*sx} ${my} H ${x2-r*sx} Q ${x2} ${my} ${x2} ${my+r*sy} V ${y2}`;
}

/**
 * Manhattan path for fixed vertical ports (route.ts's spreadPorts model: top-of-source to
 * bottom-of-target for dependency graphs, where foundations render above their dependents;
 * bottom-to-top for the Flowchart view's downward control flow): always leaves and arrives
 * straight along y, elbowing sideways only at the shared mid-height `clearY`. Geometry is
 * direction-agnostic — it takes explicit endpoints. Mirrors the mock's orthoPathBottomToTop —
 * orthoPath's dx-vs-dy branch selection is wrong here since a wide horizontal gap between
 * vertically-ported nodes would otherwise arrive sideways into the target's face.
 */
function orthoPathVertical(x1,y1,x2,y2,clearY,radius=10){
  const dx=x2-x1,sx=Math.sign(dx)||1;
  // `sy` tracks which way the path actually travels. Without it the corner radii assume a
  // downward run and overshoot `clearY` on an upward one, so the elbow doubles back on
  // itself — visible as a crooked stub on every dependency edge.
  const sy=Math.sign(clearY-y1)||1;
  if(Math.abs(dx)<2) return `M ${x1} ${y1} V ${y2}`;
  const r=Math.max(2,Math.min(radius,Math.abs(clearY-y1),Math.abs(y2-clearY),Math.abs(dx)/2));
  return `M ${x1} ${y1} V ${clearY-r*sy} Q ${x1} ${clearY} ${x1+r*sx} ${clearY} H ${x2-r*sx} Q ${x2} ${clearY} ${x2} ${clearY+r*sy} V ${y2}`;
}

/** SVG layer of connectors between canvas nodes — bezier or Manhattan-routed. */
export function ConnectorLayer({edges=[],width="100%",height="100%",arrows=true,route="curve",elbow=10,stub=14,focus,style}){
  const uid=React.useId().replace(/[^a-zA-Z0-9]/g,"");
  // `fill="context-stroke"` (one shared marker inheriting each path's stroke) isn't
  // reliably supported across browsers and silently falls back to black — invisible
  // in dark mode. Emit one marker per distinct stroke color actually in use instead.
  const strokes=[...new Set(Object.values(KIND).map((k)=>k.stroke))];
  const markerId=(stroke)=>`cd-arrow-${uid}-${strokes.indexOf(stroke)}`;
  return (
    <svg width={width} height={height} style={{position:"absolute",inset:0,overflow:"visible",pointerEvents:"none",...style}}>
      {arrows&&(
        <defs>
          {strokes.map((stroke)=>(
            <marker key={stroke} id={markerId(stroke)} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" fill={stroke}/>
            </marker>
          ))}
        </defs>
      )}
      {edges.map((e,i)=>{
        const role=edgeRole(e.from,e.to,focus);
        const isHoverKind=e.kind==="hover-in"||e.kind==="hover-out";
        const k=KIND[role==="near"&&!isHoverKind?"call":e.kind]||KIND[e.kind]||KIND.import;
        // A hover-kind edge is the thing being pointed at, so it is never dimmed. Without this
        // exemption a synthesised crossing connector — whose far endpoint is a tray row and so
        // is not in `focus.near` — would be muted by edgeRole and drawn as background.
        const dimmed=!isHoverKind&&(e.dim||role==="muted");
        const mx=(e.x1+e.x2)/2;
        const my=(e.y1+e.y2)/2;
        const routeMode=e.route||route;
        const ortho=routeMode==="ortho";
        const orthoV=routeMode==="ortho-v";
        // Curve control points sit at the midpoint-y so the path leaves/enters each node
        // vertically — matching top/bottom port attachment (route.ts) instead of bowing
        // sideways out of the node face.
        const d=orthoV
          ? orthoPathVertical(e.x1,e.y1,e.x2,e.y2,e.clearY??my,e.elbow??elbow)
          : ortho
          ? orthoPath(e.x1,e.y1,e.x2,e.y2,e.elbow??elbow,e.stub??stub)
          : `M ${e.x1} ${e.y1} C ${e.x1} ${my}, ${e.x2} ${my}, ${e.x2} ${e.y2}`;
        const pid=`cd-${uid}-${i}`;
        return (
          <g key={i}>
            <path id={pid} d={d} fill="none" stroke={k.stroke} strokeWidth={e.heavy?"var(--connector-w-heavy)":"var(--connector-w)"}
              strokeDasharray={k.dash||undefined} strokeLinecap="round"
              markerEnd={arrows&&e.directed!==false?`url(#${markerId(k.stroke)})`:undefined}
              style={k.flow?{animation:"cd-flow 1400ms linear infinite"}:undefined}
              opacity={dimmed?"var(--focus-dim-edge)":1}/>
            {k.dots&&Array.from({length:k.dots.count}).map((_,j)=>(
              <circle key={j} r={k.dots.r} fill={k.dots.fill} opacity={dimmed?"var(--focus-dim-edge)":1}>
                <animateMotion dur={`${k.dots.dur}s`} begin={`${(j*k.dots.dur)/k.dots.count}s`} repeatCount="indefinite">
                  <mpath href={`#${pid}`}/>
                </animateMotion>
              </circle>
            ))}
            {e.label&&(
              <text x={mx} y={(e.y1+e.y2)/2-6} textAnchor="middle" fill="var(--text-faint)"
                style={{font:"var(--type-metric)",fontFamily:"var(--font-mono)"}}>{e.label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Focus model for canvas highlighting. The design system owns the LOOK; the product owns
 * the traversal that produces the id sets.
 *
 * Convention:
 *  - focus.id        the hovered or clicked node — rendered "selected" (accent glow)
 *  - focus.near      1 hop from focus — full opacity, connectors go "call" bright
 *  - focus.far       2 hops (click only) — full opacity, connectors stay hairline
 *  - everything else dimmed to --focus-dim (.35)
 *  - hover is transient (1 hop); click is sticky (2 hops) until dismissed
 */
export const FOCUS_NONE={id:null,near:[],far:[],sticky:false};

/** Focus state of one node id: "self" | "near" | "far" | "muted" | "none". */
export function focusRole(id,focus){
  if(!focus||!focus.id) return "none";
  if(id===focus.id) return "self";
  if((focus.near||[]).includes(id)) return "near";
  if((focus.far||[]).includes(id)) return "far";
  return "muted";
}

/** Focus state of an edge given its endpoint ids. */
export function edgeRole(from,to,focus){
  if(!focus||!focus.id) return "none";
  const touches=from===focus.id||to===focus.id;
  if(touches) return "near";
  const inSet=id=>id===focus.id||(focus.near||[]).includes(id)||(focus.far||[]).includes(id);
  return inSet(from)&&inSet(to)?"far":"muted";
}

/** Breadth-first neighbour sets from an edge list — the reference traversal. */
export function neighbours(id,edges,depth=1){
  const near=[],far=[],seen=new Set([id]);
  let frontier=[id];
  for(let d=1;d<=depth;d++){
    const next=[];
    for(const e of edges){
      if(frontier.includes(e.from)&&!seen.has(e.to)) next.push(e.to);
      if(frontier.includes(e.to)&&!seen.has(e.from)) next.push(e.from);
    }
    for(const n of next){ seen.add(n); (d===1?near:far).push(n); }
    frontier=next;
  }
  return {id,near,far};
}

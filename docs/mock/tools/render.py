#!/usr/bin/env python3
"""
scv render — static export of the visualizer.

Reads a .scv/ store and emits one self-contained HTML file. Same data contract
the live server will serve; this is `scv serve` with the fetches inlined.

Usage:  python3 tools/render.py <.scv dir> <out.html>
"""
from __future__ import annotations
import json, sys
from pathlib import Path

REV_ORDER = ["6ab4e5e", "731c3e3", "a06810c", "57be285", "42406d1", "bed04b3", "bc3450f"]


def prune(snap: dict) -> dict:
    """Drop what the UI never reads, keep the contract shape."""
    for e in snap["edges"]:
        e["evidence"] = e.get("evidence", [])[:2]
    return snap


def load(store: Path) -> dict:
    snaps, deltas = {}, {}
    for sha in REV_ORDER:
        p = store / "snapshots" / f"{sha}.json"
        if p.exists():
            snaps[sha] = prune(json.loads(p.read_text()))
    base = REV_ORDER[0]
    for i, sha in enumerate(REV_ORDER):
        if not i:
            continue
        # deduped, order-stable: a set here makes the emitted key order vary
        # per process (PYTHONHASHSEED), so the same input renders different bytes
        for frm in dict.fromkeys([base, REV_ORDER[i - 1]]):
            p = store / "deltas" / f"{frm}__{sha}.json"
            if p.exists():
                deltas[f"{frm}__{sha}"] = json.loads(p.read_text())
    revs = [{"sha": s, **{k: snaps[s]["rev"][k] for k in
                          ("author", "ts", "message", "author_kind")}} for s in snaps]
    for r in revs:
        d = deltas.get(f"{base}__{r['sha']}")
        roll = (d or {}).get("rollup", {}).get("u:sys:orderly", {})
        r["amount"] = roll.get("amount", 0)
        r["risk"] = roll.get("risk", 0)
    return {"base": base, "revs": revs, "snapshots": snaps, "deltas": deltas}


HTML = r"""<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>scv — __REPO__</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{
  --paper:#E9EDF3;--grid:#DCE2EB;--panel:#F7F9FC;--card:#fff;
  --ink:#0F1622;--slate:#5A6880;--hair:#C4CDDA;
  --edge:#3E7BC4;--domain:#1F9184;--infra:#7B5EA7;--support:#B87D22;
  --ops:#64728A;--tests:#AC4F76;--ext:#8894A6;
  --added:#12805A;--removed:#B03A32;--modified:#C87A12;
  --hi:#C22F26;--med:#C87A12;--lo:#7A8798;
  --dep:#C22F26;--usr:#2560C0;
  --d:'Bricolage Grotesque',ui-sans-serif,system-ui,sans-serif;
  --b:'IBM Plex Sans',ui-sans-serif,system-ui,sans-serif;
  --m:'IBM Plex Mono',ui-monospace,monospace;
}
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{background:var(--paper);color:var(--ink);font:13px/1.45 var(--b);overflow:hidden;-webkit-font-smoothing:antialiased}
button{font:inherit;color:inherit;background:none;border:none;cursor:pointer}
#app{display:grid;grid-template-rows:50px 1fr 78px;height:100%}
#mid{display:grid;grid-template-columns:250px 1fr 330px;min-height:0}

#top{display:flex;align-items:center;gap:16px;padding:0 15px;background:var(--panel);border-bottom:1px solid var(--hair)}
.brand{font:800 17px/1 var(--d);letter-spacing:-.03em}
.brand i{font:400 12px var(--b);color:var(--slate);margin-left:8px;font-style:normal}
.sp{flex:1}
.lb{font-size:9.5px;text-transform:uppercase;letter-spacing:.11em;color:var(--slate)}
.seg{display:flex;border:1px solid var(--hair);border-radius:3px;overflow:hidden;background:#fff}
.seg button{padding:5px 12px;font-size:12px;color:var(--slate);border-right:1px solid var(--hair)}
.seg button:last-child{border-right:0}
.seg button.on{background:var(--ink);color:#fff;font-weight:500}

#rail,#tray{background:var(--panel);overflow-y:auto;min-height:0}
#rail{border-right:1px solid var(--hair);padding:13px}
#tray{border-left:1px solid var(--hair);padding:15px}
.sec{font-size:9.5px;text-transform:uppercase;letter-spacing:.11em;color:var(--slate);margin:19px 0 8px;padding-bottom:5px;border-bottom:1px solid var(--hair)}
.sec:first-child{margin-top:0}
#crumb{display:flex;flex-wrap:wrap;gap:2px;align-items:center;font-size:12px;margin-bottom:6px}
#crumb button{padding:1px 4px;border-radius:2px;color:var(--slate)}
#crumb button:hover{background:var(--grid);color:var(--ink)}
#crumb button.here{color:var(--ink);font-weight:600;font-family:var(--d)}
#crumb i{color:var(--hair);font-style:normal}
.lg{display:flex;align-items:center;gap:7px;padding:2px 0;font-size:11.5px;color:var(--slate)}
.chip{width:11px;height:11px;flex:none;border-radius:1px}
.q{display:block;width:100%;text-align:left;padding:7px 8px;margin-bottom:4px;border:1px solid var(--hair);border-left-width:3px;border-radius:3px;background:#fff}
.q:hover{border-color:var(--slate)}
.q.sel{background:var(--ink);border-color:var(--ink)}.q.sel *{color:#fff!important}
.q.lowconf{border-style:dashed}
.qh{display:flex;justify-content:space-between;gap:6px;align-items:baseline}
.q b{font-size:11.5px}.q em{font-style:normal;font-size:9px;color:var(--slate);text-transform:uppercase;letter-spacing:.06em}
.q p{margin:3px 0 0;font-size:10.5px;color:var(--slate);line-height:1.35}
.q .rk{font:600 10px var(--m);color:var(--slate);margin-right:5px}

#stage{position:relative;min-width:0;overflow:hidden;
  background:linear-gradient(var(--grid) 1px,transparent 1px) 0 0/100% 28px,
             linear-gradient(90deg,var(--grid) 1px,transparent 1px) 0 0/28px 100%,var(--paper)}
#svg{width:100%;height:100%;display:block}
#hint{position:absolute;left:13px;bottom:11px;font-size:10.5px;color:var(--slate);background:#ffffffd0;padding:4px 9px;border:1px solid var(--hair);border-radius:3px}
#stat{position:absolute;right:13px;bottom:11px;font:10px var(--m);color:var(--slate);background:#ffffffd0;padding:4px 9px;border:1px solid var(--hair);border-radius:3px}

.tile{cursor:pointer}
.tile .nm{font:600 13px var(--d);letter-spacing:-.015em;pointer-events:none}
.tile .mt{font-family:var(--m);pointer-events:none;fill:var(--slate)}
.tile .cx{font:600 9.5px var(--m);pointer-events:none}
.dim{opacity:.12}
.lk{fill:none;stroke:var(--slate);stroke-opacity:.3}
.lk.faint{stroke-opacity:.07}
.lk.dep{stroke:var(--dep);stroke-opacity:1}
.lk.usr{stroke:var(--usr);stroke-opacity:1}
.lk.add{stroke:var(--added);stroke-opacity:.9}
.lk.rem{stroke:var(--removed);stroke-opacity:.85;stroke-dasharray:4 3}
.lw{font:9px var(--m);fill:var(--slate);pointer-events:none}

#tray h2{font:800 19px/1.15 var(--d);letter-spacing:-.03em;margin:0}
#tray .sub{font:10.5px var(--m);color:var(--slate);margin:3px 0 12px;word-break:break-all}
.tags{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px}
.tag{font-size:9px;text-transform:uppercase;letter-spacing:.07em;padding:2px 6px;border:1px solid var(--hair);border-radius:2px;color:var(--slate);background:#fff}
.tag.hot{border-color:var(--hi);color:var(--hi)}
.w5{display:grid;grid-template-columns:42px 1fr;gap:4px 9px}
.w5 dt{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--slate);padding-top:2px}
.w5 dd{margin:0;font-size:12px}
.kv{display:grid;grid-template-columns:1fr auto;gap:2px 10px;font-size:11.5px}
.kv span:nth-child(even){font-family:var(--m);font-size:10.5px;text-align:right}
.kv span:nth-child(odd){color:var(--slate)}
.rel{display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11.5px;cursor:pointer}
.rel:hover{color:var(--dep)}
.rel .ar{font:10px var(--m);width:13px;flex:none}
.rel.up .ar{color:var(--usr)}.rel.dn .ar{color:var(--dep)}
.rel .ek{font:9px var(--m);color:var(--slate);margin-left:auto}
.ax{display:grid;grid-template-columns:70px 1fr 26px;gap:3px 8px;align-items:center}
.ax i{font-style:normal;color:var(--slate);text-transform:uppercase;letter-spacing:.06em;font-size:9px}
.bar{height:6px;background:var(--grid);border-radius:1px;overflow:hidden}.bar div{height:100%}
.ax b{font:500 10px var(--m);text-align:right}
.note{margin-top:11px;padding:7px 9px;background:#fff;border:1px solid var(--hair);border-left:3px solid var(--modified);border-radius:3px}
.note p{margin:0;font-size:10.5px;color:var(--slate)}
.diff code{display:block;font:10.5px var(--m);padding:3px 6px;border-radius:2px;margin-top:2px;white-space:pre-wrap;word-break:break-all}
.diff .o{background:#B03A3218;color:#8A2E27}.diff .n{background:#12805A18;color:#0C6547}
.empty{color:var(--slate);font-size:11.5px;font-style:italic}
.src{font:9px var(--m);color:var(--slate);border:1px solid var(--hair);border-radius:2px;padding:1px 4px;margin-left:6px}

#tl{background:var(--panel);border-top:1px solid var(--hair);padding:8px 18px;display:flex;align-items:center;gap:15px}
#play{width:28px;height:28px;flex:none;border:1px solid var(--hair);border-radius:50%;background:#fff;display:grid;place-items:center;font-size:11px}
#play:hover{border-color:var(--ink)}
#revs{flex:1;display:flex;align-items:flex-end;position:relative;height:52px}
#revs::before{content:'';position:absolute;left:0;right:0;bottom:16px;height:1px;background:var(--hair)}
.rev{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer}
.rev .amt{width:100%;max-width:46px;background:var(--hair);border-radius:1px 1px 0 0;transition:.18s}
.rev .dot{width:9px;height:9px;border-radius:50%;background:#fff;border:1.5px solid var(--hair)}
.rev .cap{font:9.5px var(--m);color:var(--slate)}
.rev.past .dot{border-color:var(--slate)}
.rev.on .dot{background:var(--ink);border-color:var(--ink);transform:scale(1.3)}
.rev.on .cap{color:var(--ink);font-weight:600}
.rev.base .dot{background:var(--slate);border-color:var(--slate)}
.rev.human .amt{background:var(--edge)}
#tlm{width:230px;flex:none;font-size:10.5px;color:var(--slate);text-align:right;line-height:1.35}
#tlm b{display:block;color:var(--ink);font-size:11.5px}
</style>

<div id="app">
 <div id="top">
  <div class="brand">scv<i>__REPO__ · <span id="revlbl"></span></i></div>
  <div class="sp"></div>
  <div class="lb">View</div>
  <div class="seg" id="mode">
   <button data-m="current" class="on">Current</button>
   <button data-m="delta">Delta</button>
   <button data-m="flows">Flows</button>
   <button data-m="ext">Depends on</button>
  </div>
  <div class="lb" id="cmplb" style="display:none">Against</div>
  <div class="seg" id="cmp" style="display:none">
   <button data-c="prev" class="on">Previous</button>
   <button data-c="base">Branch base</button>
  </div>
  <div class="lb">Skin</div>
  <div class="seg" id="skin">
   <button data-s="tiles" class="on">Tiles</button>
   <button data-s="prisms">Prisms</button>
  </div>
 </div>
 <div id="mid">
  <div id="rail"></div>
  <div id="stage"><svg id="svg"></svg>
   <div id="hint">Double-click to drill in · hover to trace dependencies</div>
   <div id="stat"></div></div>
  <div id="tray"></div>
 </div>
 <div id="tl"><button id="play" title="Replay">▶</button><div id="revs"></div><div id="tlm"></div></div>
</div>

<script>
const DATA = __DATA__;
const SYS = 'u:sys:orderly';

/* ── state ─────────────────────────────────────────────── */
let S = {rev: DATA.revs.length-1, mode:'current', skin:'tiles', focus:SYS, sel:SYS,
         flow:null, cmp:'prev', play:0};

const snap = () => DATA.snapshots[DATA.revs[S.rev].sha];
/* `cmp` picks the left-hand side of the comparison:
     prev — this revision against its parent   ("what did this commit do")
     base — this revision against the branch base ("what does this PR do")   */
const cmpFrom = () => S.cmp==='base' || S.rev===0 ? DATA.base : DATA.revs[S.rev-1].sha;
const delta = () => DATA.deltas[cmpFrom()+'__'+DATA.revs[S.rev].sha] || null;
let IDX = null;
function reindex(){
  const s = snap();
  const U = {}; s.units.forEach(u => U[u.id] = u);
  const out = {}, inn = {};
  s.edges.forEach(e => { (out[e.from] = out[e.from]||[]).push(e); (inn[e.to] = inn[e.to]||[]).push(e); });
  const d = delta();
  const DU = {}, RU = {};
  if(d){ d.unit_deltas.forEach(x => DU[x.unit] = x); Object.assign(RU, d.rollup||{}); }
  IDX = {U, out, inn, DU, RU, d, edges:s.edges, ext:s.externals};
}

const cv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const U = id => IDX.U[id];
const anc = id => { const a=[]; let c=U(id); while(c){ a.unshift(c.id); c = c.parent?U(c.parent):null; } return a; };
const layerOf = id => { let c = U(id); while(c){ if(c.kind==='layer') return c.qualname; c = c.parent?U(c.parent):null; } return null; };
const LC = {edge:'--edge',domain:'--domain',infra:'--infra',support:'--support',ops:'--ops',tests:'--tests'};
const hue = id => cv(LC[layerOf(id)] || '--ext');
const isFlow = id => U(id)?.kind === 'api_flow';
const kids = id => (U(id)?.children||[]).filter(c => IDX.U[c] && !isFlow(c));
const flows = () => (U(SYS)?.children||[]).filter(c => isFlow(c));
/* the visible tile that contains a unit at the current focus level */
const visibleAnc = (id, set) => { let c=U(id); while(c){ if(set.has(c.id)) return c.id; c=c.parent?U(c.parent):null; } return null; };
const sloc = u => (u.loc?.sloc ?? u.metrics?.sloc ?? 1);

/* complexity: own, else max over descendants — "the hardest thing inside" */
function cx(id){
  const u = U(id); if(!u) return 0;
  if(u.cost?.complexity != null && !(u.children||[]).length) return u.cost.complexity;
  let m = u.cost?.complexity || 0;
  kids(id).forEach(k => m = Math.max(m, cx(k)));
  return m;
}
const SIDES = c => c<=2 ? 3 : c<=5 ? 4 : c<=12 ? 6 : 0;   /* 0 = circle */

/* ── layout: rank → dummy expansion → order → place → route ──────
   Long edges are broken into chains through dummy nodes, so an edge that
   spans three ranks is ordered inside every row it passes through instead
   of cutting across them. This is what actually removes crossings; lane
   assignment alone only stops parallel runs from overlapping.        */
function layout(pid, W, H){
  const ns = kids(pid);
  if(!ns.length) return {nodes:[], links:[]};
  const set = new Set(ns);
  const local = IDX.edges.filter(e => set.has(e.from) && set.has(e.to) && e.from !== e.to);

  /* bundle parallel edges between the same pair */
  const bm={};
  local.forEach(e=>{ const k=e.from+'>'+e.to;
    (bm[k]=bm[k]||{from:e.from,to:e.to,w:0,kinds:new Set()});
    bm[k].w+=e.weight; bm[k].kinds.add(e.kind); });
  const bundles=Object.values(bm).map(b=>({...b,kinds:[...b.kinds]}));

  /* rank: longest path, callers above callees */
  const rank={}; ns.forEach(n=>rank[n]=0);
  for(let i=0;i<ns.length;i++){ let ch=0;
    bundles.forEach(b=>{ if(rank[b.to]<rank[b.from]+1){ rank[b.to]=rank[b.from]+1; ch=1; } });
    if(!ch) break; }
  const maxR=Math.max(...ns.map(n=>rank[n]));
  const rows=[]; for(let r=0;r<=maxR;r++) rows.push(ns.filter(n=>rank[n]===r));

  /* dummy expansion */
  const dummy=new Set(), chains=[];
  bundles.forEach(b=>{
    const r0=rank[b.from], r1=rank[b.to];
    if(r1<=r0){ chains.push({b, ch:[b.from,b.to], back:true}); return; }
    const ch=[b.from];
    for(let r=r0+1;r<r1;r++){
      const id='~'+b.from+'|'+b.to+'|'+r;
      rank[id]=r; rows[r].push(id); dummy.add(id); ch.push(id);
    }
    ch.push(b.to); chains.push({b, ch});
  });

  /* order: barycentre sweeps over the chain adjacency (dummies included) */
  const adj=[];
  chains.forEach(c=>{ if(c.back) return;
    for(let i=0;i<c.ch.length-1;i++) adj.push({from:c.ch[i], to:c.ch[i+1]}); });
  const bary=(n,dir,pos)=>{
    const src = dir==='down' ? adj.filter(a=>a.to===n).map(a=>pos[a.from])
                             : adj.filter(a=>a.from===n).map(a=>pos[a.to]);
    const v = src.filter(x=>x!==undefined);
    if(!v.length) return null;
    v.sort((a,b)=>a-b);
    const m=v.length>>1;
    return v.length%2 ? v[m] : (v[m-1]+v[m])/2;
  };
  for(let s=0;s<8;s++){
    const down=s%2===0;
    const seq=rows.map((_,i)=>i); if(!down) seq.reverse();
    seq.forEach(ri=>{
      const near=rows[down?ri-1:ri+1]; if(!near) return;
      const pos={}; near.forEach((n,i)=>pos[n]=i);
      rows[ri]=rows[ri].map((n,i)=>({n,b:bary(n,down?'down':'up',pos),i}))
        .sort((a,b)=>(a.b??a.i)-(b.b??b.i) || a.n.localeCompare(b.n)).map(o=>o.n);
    });
  }

  /* place: √-area by sloc, width CAPPED and rows CENTRED. Without a cap a
     lone node in a row stretches to the full canvas, which leaves no gap for
     a skip-level edge to pass through and forces its dummy out to the margin. */
  const PX=36, PY=24, GY=Math.min(78,(H-2*PY)/rows.length*0.4), GX=18, DW=6;
  const rowH=(H-2*PY-GY*(rows.length-1))/rows.length;
  const MINW=Math.min(92,(W-2*PX)/6), MAXW=Math.max(MINW+20, W*0.26);
  const nodes=[], by={}, rowGeom=[];
  /* phase 1 — every real node in every row, so dummy interpolation below can
     see both endpoints of a chain regardless of direction */
  rows.forEach((row,ri)=>{
    const y=PY+ri*(rowH+GY);
    const real=row.filter(n=>!dummy.has(n));
    const w8={}; real.forEach(n=>w8[n]=Math.sqrt(Math.max(sloc(U(n)),4)));
    const tot=real.reduce((a,n)=>a+w8[n],0)||1;
    const avail=W-2*PX-GX*Math.max(real.length-1,0);
    let ws=real.map(n=>Math.max(MINW,Math.min(MAXW, avail*w8[n]/tot)));
    let sum=ws.reduce((a,v)=>a+v,0);
    if(sum>avail){ const k=avail/sum; ws=ws.map(v=>Math.max(24,v*k)); sum=ws.reduce((a,v)=>a+v,0); }
    let x=(W-(sum+GX*Math.max(real.length-1,0)))/2;
    real.forEach((n,i)=>{ const nd={id:n,x,y,w:ws[i],h:rowH,rank:ri,dummy:false};
      nodes.push(nd); by[n]=nd; x+=ws[i]+GX; });
    rowGeom[ri]={y, spans:real.map(n=>[by[n].x, by[n].x+by[n].w])};
  });

  /* phase 2 — dummies go where the edge actually wants to pass: interpolate
     between the chain's real endpoints, then slide clear of any tile */
  rows.forEach((row,ri)=>{
    const dums=row.filter(n=>dummy.has(n)); if(!dums.length) return;
    const {y,spans}=rowGeom[ri], placed=[];
    dums.map(n=>{
      const pr=n.split('|'), from=pr[0].slice(1), to=pr[1];
      const t=(ri-rank[from])/Math.max(rank[to]-rank[from],1);
      const ax=by[from].x+by[from].w/2, bx=by[to].x+by[to].w/2;
      return {n, tx: ax+(bx-ax)*t};
    }).sort((p,q)=>p.tx-q.tx).forEach(({n,tx})=>{
      let cx2=tx;
      for(let pass=0;pass<8;pass++){
        const hit=spans.find(([lo,hi])=>cx2>lo-10&&cx2<hi+10);
        if(!hit) break;
        cx2 = (cx2-hit[0] <= hit[1]-cx2) ? hit[0]-12 : hit[1]+12;
      }
      if(placed.some(v=>Math.abs(v-cx2)<11)){
        let best=null;
        for(let k=1;k<40;k++) for(const dir of [-1,1]){
          const c=cx2+dir*k*11;
          if(c<10||c>W-10) continue;
          if(spans.some(([lo,hi])=>c>lo-10&&c<hi+10)) continue;
          if(placed.some(v=>Math.abs(v-c)<11)) continue;
          if(best===null||Math.abs(c-cx2)<Math.abs(best-cx2)) best=c;
        }
        if(best!==null) cx2=best;
      }
      cx2=Math.max(10,Math.min(W-10,cx2)); placed.push(cx2);
      by[n]={id:n,x:cx2-DW/2,y,w:DW,h:rowH,rank:ri,dummy:true};
    });
  });

  /* route: two passes. Pass 1 packs each channel into the fewest lanes whose
     horizontal spans do not overlap. Pass 2 spreads those lanes evenly across
     the channel height — assigning y in pass 1 collapses lanes onto each other
     as soon as a channel needs more of them than it has pixels.            */
  /* port spreading: edges leaving a node fan across its bottom edge and edges
     arriving fan across its top edge, ordered by the other end's x. Without
     this every edge into a node lands on the same pixel and the last few
     centimetres of many edges are drawn on top of each other. */
  const outP={}, inP={};
  chains.forEach((c,ci)=>{
    if(c.back) return;
    const a=by[c.ch[0]], t=by[c.ch[c.ch.length-1]];
    (outP[c.ch[0]]=outP[c.ch[0]]||[]).push({ci, k:by[c.ch[1]].x});
    (inP[t.id]=inP[t.id]||[]).push({ci, k:by[c.ch[c.ch.length-2]].x});
  });
  const portX={};
  const spread=(map,side)=>{ for(const id in map){
    const n=by[id], L=map[id].sort((p,q)=>p.k-q.k);
    const inset=Math.min(14,n.w*0.2), span=n.w-2*inset;
    L.forEach((e,i)=>{ portX[side+e.ci]= n.dummy ? n.x+n.w/2
      : n.x+inset+span*(L.length===1?0.5:i/(L.length-1)); });
  }};
  spread(outP,'o'); spread(inP,'i');

  const lanes={}, cxOf=n=>by[n].x+by[n].w/2;
  const packed=chains.map((c,ci)=>{
    const {b,ch,back}=c;
    if(back) return {b,ch,back};
    const segs=[];
    for(let i=1;i<ch.length;i++){
      const px = i===1 ? (portX['o'+ci] ?? cxOf(ch[0])) : cxOf(ch[i-1]);
      const cx2 = i===ch.length-1 ? (portX['i'+ci] ?? cxOf(ch[i])) : cxOf(ch[i]);
      const chn=by[ch[i-1]].rank;
      const lo=Math.min(px,cx2)-6, hi=Math.max(px,cx2)+6;
      const L=(lanes[chn]=lanes[chn]||[]);
      let li=L.findIndex(sp=>sp.every(([a,z])=>hi<a||lo>z));
      if(li<0){ li=L.length; L.push([]); }
      L[li].push([lo,hi]);
      segs.push({i,li,chn,px,cx2});
    }
    return {b,ch,segs};
  });

  const links=packed.map((c,ci)=>{
    const {b,ch,back,segs}=c;
    if(back){
      const a=by[b.from], t=by[b.to], sx=cxOf(b.from), tx=cxOf(b.to);
      const side = sx<tx ? Math.min(a.x,t.x)-20 : Math.max(a.x+a.w,t.x+t.w)+20;
      return {...b, pts:[[sx,a.y+a.h/2],[side,a.y+a.h/2],[side,t.y+t.h/2],[tx,t.y+t.h/2]]};
    }
    const pts=[[portX['o'+ci] ?? cxOf(ch[0]), by[ch[0]].y+by[ch[0]].h]];
    segs.forEach(sg=>{
      const prev=by[ch[sg.i-1]], cur=by[ch[sg.i]];
      const top=prev.y+prev.h, bot=cur.y, gap=bot-top;
      const n=lanes[sg.chn].length;
      const y = top + gap*(sg.li+1)/(n+1);
      if(Math.abs(sg.cx2-sg.px)>2) pts.push([sg.px,y],[sg.cx2,y]);
      pts.push([sg.cx2, sg.i<ch.length-1 ? cur.y+cur.h : cur.y]);
    });
    return {...b, pts};
  });

  return {nodes, links, lanes:Object.values(lanes).reduce((a,l)=>a+l.length,0),
          dummies:dummy.size};
}

/* ── svg helpers ───────────────────────────────────────── */
const NS='http://www.w3.org/2000/svg';
const svg=document.getElementById('svg');
const el=(t,a)=>{const n=document.createElementNS(NS,t);for(const k in a)if(a[k]!=null)n.setAttribute(k,a[k]);return n;};
const round=(pts,r=7)=>{
  if(pts.length<3) return `M${pts[0]} L${pts[pts.length-1]}`;
  let d=`M${pts[0]}`;
  for(let i=1;i<pts.length-1;i++){
    const [px,py]=pts[i-1],[x,y]=pts[i],[nx,ny]=pts[i+1];
    const d1=Math.hypot(x-px,y-py), d2=Math.hypot(nx-x,ny-y);
    const r1=Math.min(r,d1/2), r2=Math.min(r,d2/2);
    d+=` L${x+(px-x)/d1*r1},${y+(py-y)/d1*r1} Q${x},${y} ${x+(nx-x)/d2*r2},${y+(ny-y)/d2*r2}`;
  }
  return d+` L${pts[pts.length-1]}`;
};
const ngon=(cx,cy,rx,ry,n,rot=-Math.PI/2)=>{
  if(!n) { const p=[]; for(let i=0;i<24;i++){const a=rot+i/24*2*Math.PI; p.push([cx+rx*Math.cos(a),cy+ry*Math.sin(a)]);} return p; }
  const p=[]; for(let i=0;i<n;i++){const a=rot+i/n*2*Math.PI; p.push([cx+rx*Math.cos(a),cy+ry*Math.sin(a)]);}
  return p;
};
const ptstr = p => p.map(q=>q.map(v=>v.toFixed(1)).join(',')).join(' ');
const hull = pts => {
  const s=[...pts].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lo=[],up=[];
  for(const p of s){ while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop(); lo.push(p); }
  for(const p of s.reverse()){ while(up.length>=2&&cr(up[up.length-2],up[up.length-1],p)<=0)up.pop(); up.push(p); }
  return lo.slice(0,-1).concat(up.slice(0,-1));
};

/* delta appearance for a unit (own delta, else rollup) */
function dstate(id){
  if(S.mode!=='delta') return null;
  const own=IDX.DU[id], roll=IDX.RU[id];
  if(own) return {status:own.status, amount:own.amount, risk:own.risk.score, own:true, d:own};
  if(roll) return {status: roll.amount>0?'modified':'unchanged', amount:roll.amount, risk:roll.risk, own:false};
  return {status:'unchanged', amount:0, risk:0, own:false};
}

/* ── draw ──────────────────────────────────────────────── */
function draw(){
  const st=document.getElementById('stage'), W=st.clientWidth, H=st.clientHeight;
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`); svg.innerHTML='';
  if(S.mode==='ext') return drawExt(W,H);
  if(S.mode==='flows') return drawFlow(W,H);
  const sc=layout(S.focus,W,H);
  (S.skin==='prisms'?drawPrisms:drawTiles)(sc,W,H);
  document.getElementById('stat').textContent =
    `${sc.nodes.length} units · ${sc.links.length} bundles · ${sc.lanes||0} lanes · ${sc.dummies||0} dummies`;
  bind(sc);
}

/* density gating: above this ratio, background edges go faint */
const gated = sc => sc.links.length > sc.nodes.length*1.6;

function drawLinks(g, sc, map){
  const gate=gated(sc);
  sc.links.forEach(L=>{
    const p=el('path',{d:round(L.pts.map(map)),class:'lk'+(gate?' faint':''),
      'stroke-width':Math.min(3.2,1+Math.log2(L.w+1)*0.7)});
    p.dataset.from=L.from; p.dataset.to=L.to;
    if(S.mode==='delta'){
      const a=dstate(L.from),b=dstate(L.to);
      if(a?.status==='added'||b?.status==='added') p.classList.add('add');
      if(a?.status==='removed'||b?.status==='removed') p.classList.add('rem');
    }
    g.appendChild(p);
    if(L.w>1 && !gate){
      const m=L.pts[Math.floor(L.pts.length/2)], q=map(m);
      const t=el('text',{x:q[0]+5,y:q[1]-3,class:'lw'}); t.textContent='×'+L.w; g.appendChild(t);
    }
  });
}

function tileFill(id, c){
  const d=dstate(id);
  if(!d) return {fill:c+'22', stroke:c, sw:1.5, dash:null};
  if(d.status==='added')   return {fill:cv('--added')+'2A', stroke:cv('--added'), sw:2, dash:null};
  if(d.status==='removed') return {fill:cv('--removed')+'14', stroke:cv('--removed'), sw:1.6, dash:'5 3'};
  if(d.amount>0){ const a=Math.round(22+d.amount*40).toString(16).padStart(2,'0');
    return {fill:cv('--modified')+a, stroke:cv('--modified'), sw:1.6, dash:null}; }
  return {fill:'#00000007', stroke:cv('--hair'), sw:1, dash:null};
}

function complexGlyph(g, x, y, id, stroke){
  const c=cx(id); if(!c) return;
  const n=SIDES(c), R=7.5;
  g.appendChild(el('polygon',{points:ptstr(ngon(x,y,R,R,n)),
    fill:stroke,'fill-opacity':.16,stroke:stroke,'stroke-width':1.3,'stroke-linejoin':'round'}));
  const t=el('text',{x:x-R-4,y:y+3.4,'text-anchor':'end',class:'cx',fill:stroke});
  t.textContent=c; g.appendChild(t);
}

function flowOverlay(g, sc, map){
  if(!S.flow) return;
  const f=U(S.flow); if(!f?.steps) return;
  const set=new Set(sc.nodes.map(n=>n.id)), by={}; sc.nodes.forEach(n=>by[n.id]=n);
  const seq=[]; f.steps.forEach(s=>{ const a=visibleAnc(s,set); if(a && a!==seq[seq.length-1]) seq.push(a); });
  const on=new Set(seq);
  sc.nodes.forEach(n=>{ if(!on.has(n.id)){ const t=svg.querySelector(`.tile[data-id="${n.id}"]`); t&&t.classList.add('dim'); } });
  const pts=seq.map(id=>map([by[id].x+by[id].w/2, by[id].y+by[id].h/2]));
  if(pts.length<2) return;
  g.appendChild(el('path',{d:round(pts,14),fill:'none',stroke:cv('--ink'),
    'stroke-width':2.6,'stroke-opacity':.9,'stroke-linecap':'round','marker-end':'url(#ah)'}));
  pts.forEach((p,i)=>{
    g.appendChild(el('circle',{cx:p[0],cy:p[1],r:10,fill:cv('--ink')}));
    const t=el('text',{x:p[0],y:p[1]+3.5,'text-anchor':'middle','font-size':10,
      'font-family':'var(--m)','font-weight':600,fill:'#fff'}); t.textContent=i+1; g.appendChild(t);
  });
}

function arrowDef(){
  const d=el('defs'); const m=el('marker',{id:'ah',viewBox:'0 0 10 10',refX:8,refY:5,
    markerWidth:5,markerHeight:5,orient:'auto-start-reverse'});
  m.appendChild(el('path',{d:'M0,0 L10,5 L0,10 z',fill:cv('--ink')})); d.appendChild(m); return d;
}

function drawTiles(sc,W,H){
  const g=el('g'); svg.appendChild(g); g.appendChild(arrowDef());
  const gl=el('g'); g.appendChild(gl); const gn=el('g'); g.appendChild(gn);
  drawLinks(gl, sc, p=>p);

  sc.nodes.forEach(N=>{
    const u=U(N.id), c=hue(N.id), st=tileFill(N.id,c), d=dstate(N.id);
    const gr=el('g',{class:'tile'}); gr.dataset.id=N.id;
    const CH=Math.min(14,N.h/4,N.w/6);
    const pts=[[N.x+CH,N.y],[N.x+N.w,N.y],[N.x+N.w,N.y+N.h-CH],[N.x+N.w-CH,N.y+N.h],[N.x,N.y+N.h],[N.x,N.y+CH]];
    gr.appendChild(el('polygon',{points:ptstr(pts),fill:st.fill,stroke:st.stroke,
      'stroke-width':st.sw,'stroke-dasharray':st.dash,'stroke-linejoin':'round'}));
    if(d && d.risk>=.5)
      gr.appendChild(el('polygon',{points:ptstr(pts.map(([x,y])=>[x+3,y+3])),fill:'none',
        stroke:cv('--hi'),'stroke-width':1,'stroke-opacity':.85,'stroke-linejoin':'round'}));

    const t1=el('text',{x:N.x+12,y:N.y+22,class:'nm','font-size':Math.min(14,Math.max(10.5,N.w/10)),fill:cv('--ink')});
    t1.textContent=u.name; gr.appendChild(t1);
    const meta = d && d.own
      ? `${d.status.replace('_',' ')} · amt ${d.amount.toFixed(2)} · risk ${d.risk.toFixed(2)}`
      : u.metrics?.fan_in!=null
        ? `${sloc(u)} sloc · in ${u.metrics.fan_in} · out ${u.metrics.fan_out}`
        : `${sloc(u)} sloc · ${u.metrics?.modules??kids(u.id).length} modules`;
    const t2=el('text',{x:N.x+12,y:N.y+36,class:'mt','font-size':9.5}); t2.textContent=meta;
    gr.appendChild(t2);
    complexGlyph(gr, N.x+N.w-16, N.y+16, N.id, st.stroke);

    if(d && d.own && d.d.risk.rank){
      gr.appendChild(el('circle',{cx:N.x+N.w-16,cy:N.y+N.h-15,r:8.5,
        fill:d.risk>=.5?cv('--hi'):cv('--lo')}));
      const r=el('text',{x:N.x+N.w-16,y:N.y+N.h-11.5,'text-anchor':'middle','font-size':9.5,
        'font-family':'var(--m)','font-weight':600,fill:'#fff'});
      r.textContent=d.d.risk.rank; gr.appendChild(r);
    }
    minimap(gr,N);
    gn.appendChild(gr);
  });
  flowOverlay(g, sc, p=>p);
}

/* nested mini-map: the real layout engine at a nominal size, then uniformly
   scaled to fit. Running it directly at tile size let the engine's absolute
   minimums (92px tiles, 18px gutters) exceed the box, so rows centred to a
   negative x and children spilled out of both sides of the parent.        */
let CLIP=0;
function minimap(gr,N){
  const ck=kids(N.id); if(!ck.length) return;
  const bx=N.x+11, by=N.y+46, bw=N.w-22, bh=N.h-58;
  if(bw<40||bh<20){
    if(bh>8){ const t=el('text',{x:N.x+12,y:N.y+N.h-10,class:'mt','font-size':9});
      t.textContent=`${ck.length} inside`; gr.appendChild(t); }
    return;
  }
  const NW=560, NH=340;
  const sub=layout(N.id,NW,NH);
  const sc=Math.min(bw/NW, bh/NH);
  if(sc*NW < 30){ const t=el('text',{x:N.x+12,y:N.y+N.h-10,class:'mt','font-size':9});
    t.textContent=`${ck.length} inside`; gr.appendChild(t); return; }
  const cid='c'+(++CLIP);
  const cp=el('clipPath',{id:cid});
  cp.appendChild(el('rect',{x:bx,y:by,width:bw,height:bh}));
  gr.appendChild(cp);
  const g=el('g',{transform:`translate(${bx},${by}) scale(${sc})`,
                  'clip-path':`url(#${cid})`,opacity:.8});
  sub.links.forEach(L=>g.appendChild(el('path',{d:round(L.pts,10),fill:'none',
    stroke:cv('--slate'),'stroke-opacity':.28,'stroke-width':1.4/sc})));
  sub.nodes.forEach(n=>{
    const d=dstate(n.id);
    const f = d ? (d.status==='added'?cv('--added'):d.status==='removed'?cv('--removed'):
                   d.amount>0?cv('--modified'):cv('--hair')) : hue(n.id);
    g.appendChild(el('rect',{x:n.x,y:n.y,width:n.w,height:Math.max(6,n.h),rx:3,
      fill:f,'fill-opacity':(d&&!d.amount&&d.status!=='added')?.22:.5,
      stroke:f,'stroke-width':1.2/sc,'stroke-opacity':.6}));
  });
  gr.appendChild(g);
}

/* prisms: n-gon extruded by sloc — sides carry complexity in 3D too */
function drawPrisms(sc,W,H){
  const K=0.52, OY=H*0.16;
  const map=([x,y])=>[x, y*K+OY];
  const g=el('g'); svg.appendChild(g);
  const gl=el('g'); g.appendChild(gl); const gn=el('g'); g.appendChild(gn);
  drawLinks(gl, sc, map);

  [...sc.nodes].sort((a,b)=>(a.y+a.h)-(b.y+b.h)).forEach(N=>{
    const u=U(N.id), c=hue(N.id), st=tileFill(N.id,c);
    const [ccx,ccy]=map([N.x+N.w/2, N.y+N.h/2]);
    const rx=Math.min(N.w,N.h*1.9)*0.36, ry=rx*0.5;
    const dep=Math.min(74, 14+sloc(u)*1.5);
    const n=SIDES(cx(N.id));
    const base=ngon(ccx,ccy,rx,ry,n), top=base.map(([x,y])=>[x,y-dep]);
    const gr=el('g',{class:'tile'}); gr.dataset.id=N.id;
    gr.appendChild(el('polygon',{points:ptstr(hull(base.concat(top))),
      fill:st.stroke,'fill-opacity':.24,stroke:st.stroke,'stroke-width':st.sw,
      'stroke-dasharray':st.dash,'stroke-linejoin':'round'}));
    gr.appendChild(el('polygon',{points:ptstr(top),fill:st.fill.slice(0,7),
      'fill-opacity':.92,stroke:st.stroke,'stroke-width':st.sw,'stroke-linejoin':'round'}));
    base.forEach((p,i)=>{ if(i%1===0) gr.appendChild(el('line',{x1:p[0],y1:p[1],
      x2:top[i][0],y2:top[i][1],stroke:st.stroke,'stroke-opacity':.35,'stroke-width':.7})); });
    const t=el('text',{x:ccx,y:ccy-dep-9,'text-anchor':'middle',class:'nm','font-size':11.5,fill:cv('--ink')});
    t.textContent=u.name; gr.appendChild(t);
    const m=el('text',{x:ccx,y:ccy+ry+13,'text-anchor':'middle',class:'mt','font-size':9});
    m.textContent=`${sloc(u)} sloc · cx ${cx(N.id)}`; gr.appendChild(m);
    gn.appendChild(gr);
  });
  flowOverlay(g, sc, map);
}

/* Flows — a view of its own, not a list bolted onto the system view. An entry
   point is selected on the left; the canvas renders only the units that request
   actually traverses, in order, at whatever granularity the steps were traced. */
function drawFlow(W,H){
  document.getElementById('stat').textContent='';
  const f=U(S.flow)||U(flows()[0]); if(!f){ return; }
  S.flow=f.id;
  const g=el('g'); svg.appendChild(g); g.appendChild(arrowDef());
  const steps=(f.steps||[]).filter(x=>IDX.U[x]);
  const PY=30, GAP=14, CW=Math.min(560,W-140);
  const cardH=Math.max(38,Math.min(76,(H-2*PY-GAP*(steps.length-1))/Math.max(steps.length,1)));
  const x0=(W-CW)/2;

  steps.forEach((sid,i)=>{
    const u=U(sid), c=hue(sid), y=PY+i*(cardH+GAP), d=dstate(sid);
    const gr=el('g',{class:'tile'}); gr.dataset.id=sid;
    const st=tileFill(sid,c);
    gr.appendChild(el('rect',{x:x0,y,width:CW,height:cardH,rx:4,
      fill:st.fill,stroke:st.stroke,'stroke-width':st.sw,'stroke-dasharray':st.dash}));
    gr.appendChild(el('rect',{x:x0,y,width:4,height:cardH,rx:2,fill:c}));
    /* ordinal */
    gr.appendChild(el('circle',{cx:x0-22,cy:y+cardH/2,r:11,fill:cv('--ink')}));
    const o=el('text',{x:x0-22,y:y+cardH/2+3.7,'text-anchor':'middle','font-size':10.5,
      'font-family':'var(--m)','font-weight':600,fill:'#fff'}); o.textContent=i+1;
    gr.appendChild(o);

    const nm=el('text',{x:x0+16,y:y+21,class:'nm','font-size':13.5,fill:cv('--ink')});
    nm.textContent=u.name; gr.appendChild(nm);
    const loc=el('text',{x:x0+CW-14,y:y+21,class:'mt','font-size':9.5,'text-anchor':'end'});
    loc.textContent=`${(u.loc?.files?.[0]||'').split('/').slice(-1)[0]}${u.loc?.start?':'+u.loc.start:''} · ${sloc(u)} sloc`;
    gr.appendChild(loc);
    if(cardH>52 && u.semantics){
      const w=el('text',{x:x0+16,y:y+38,class:'mt','font-size':10.5,fill:cv('--slate')});
      let t=u.semantics.what; if(t.length>78) t=t.slice(0,76)+'…';
      w.textContent=t; gr.appendChild(w);
    }
    complexGlyph(gr, x0+CW-22, y+cardH-15, sid, st.stroke);
    if(d && d.own){
      gr.appendChild(el('circle',{cx:x0+14,cy:y+cardH-13,r:4,
        fill:d.status==='added'?cv('--added'):d.status==='removed'?cv('--removed'):cv('--modified')}));
    }
    g.appendChild(gr);

    if(i<steps.length-1){
      const yy=y+cardH;
      g.appendChild(el('path',{d:`M${x0+CW/2},${yy} L${x0+CW/2},${yy+GAP-2}`,
        stroke:cv('--slate'),'stroke-opacity':.55,'stroke-width':1.6,'marker-end':'url(#ah)'}));
      const e=IDX.edges.find(z=>z.from===sid&&z.to===steps[i+1]);
      if(e){ const k=el('text',{x:x0+CW/2+9,y:yy+GAP-5,class:'lw'}); k.textContent=e.kind; g.appendChild(k); }
    }
  });
  bind({nodes:steps.map(id=>({id})),links:[]});
}

function drawExt(W,H){
  document.getElementById('stat').textContent='';
  const g=el('g'); svg.appendChild(g); const ex=IDX.ext||[];
  const depths=[...new Set(ex.map(x=>x.depth))].sort();
  const PY=46, rowH=(H-2*PY)/Math.max(depths.length,1);
  depths.forEach((dp,di)=>{
    const y=PY+di*rowH;
    const l=el('text',{x:16,y:y+12,class:'mt','font-size':9.5});
    l.textContent=`depth ${dp} · ${dp===1?'direct':'transitive'}`; g.appendChild(l);
    g.appendChild(el('line',{x1:16,y1:y+19,x2:W-16,y2:y+19,stroke:cv('--hair')}));
    const row=ex.filter(x=>x.depth===dp), cw=(W-80)/Math.max(row.length,1);
    row.forEach((x,i)=>{
      const cxp=50+i*cw+cw/2, cyp=y+19+rowH*.42;
      const r=22+Math.sqrt((x.transitive_count??1))*8;
      const isNew=(x.reached_by||[]).length && S.mode==='delta' &&
        Object.values(IDX.DU).some(d=>d.status==='added' && (x.reached_by||[]).includes(d.unit));
      const gr=el('g',{class:'tile'}); gr.dataset.ext=x.id;
      gr.appendChild(el('circle',{cx:cxp,cy:cyp,r,fill:(isNew?cv('--added'):cv('--ext'))+'22',
        stroke:isNew?cv('--added'):cv('--ext'),'stroke-width':isNew?2:1.3}));
      const t=el('text',{x:cxp,y:cyp+4,'text-anchor':'middle',class:'nm','font-size':12.5,fill:cv('--ink')});
      t.textContent=x.name; gr.appendChild(t);
      const v=el('text',{x:cxp,y:cyp+r+14,'text-anchor':'middle',class:'mt','font-size':9.5});
      v.textContent=`${x.version||'—'} · ${(x.reached_by||[]).length} call sites`; gr.appendChild(v);
      g.appendChild(gr);
    });
  });
  const n=el('text',{x:16,y:H-16,class:'mt','font-size':10,fill:cv('--slate')});
  n.textContent='Transitive depth not computed — requirements.txt has no lockfile. Depth ≥2 unavailable, not empty.';
  g.appendChild(n);
  svg.querySelectorAll('[data-ext]').forEach(n=>n.onclick=()=>{S.sel=n.dataset.ext;renderTray();});
}

/* ── interaction ───────────────────────────────────────── */
function bind(sc){
  const tiles=[...svg.querySelectorAll('.tile[data-id]')];
  const links=[...svg.querySelectorAll('.lk')];
  const gate=gated(sc);
  tiles.forEach(t=>{
    const id=t.dataset.id;
    t.onmouseenter=()=>{
      const dn=new Set(), up=new Set();
      IDX.edges.forEach(e=>{ if(e.from===id)dn.add(e.to); if(e.to===id)up.add(e.from); });
      tiles.forEach(o=>{ const i=o.dataset.id; if(i!==id&&!dn.has(i)&&!up.has(i)) o.classList.add('dim'); });
      links.forEach(l=>{
        l.classList.remove('faint');
        if(l.dataset.from===id) l.classList.add('dep');
        else if(l.dataset.to===id) l.classList.add('usr');
        else l.classList.add(gate?'faint':'dim');
      });
    };
    t.onmouseleave=()=>{ tiles.forEach(o=>o.classList.remove('dim'));
      links.forEach(l=>{ l.classList.remove('dim','dep','usr'); if(gate)l.classList.add('faint'); }); };
    t.onclick=()=>{ S.sel=id; S.flow=null; renderTray(); renderRail(); draw(); };
    t.ondblclick=()=>{ if(kids(id).length){ S.focus=id; S.sel=id; render(); } };
  });
  svg.ondblclick=e=>{ if(e.target===svg){ const p=U(S.focus)?.parent; if(p){S.focus=p;S.sel=p;render();} } };
}

/* ── rails ─────────────────────────────────────────────── */
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;');
const rc=v=>v>=.6?'--hi':v>=.3?'--med':'--lo';

function renderRail(){
  const r=document.getElementById('rail'); const path=anc(S.focus);
  let h=`<div id="crumb">`;
  path.forEach((p,i)=>h+=`${i?'<i>›</i>':''}<button data-go="${p}" class="${i===path.length-1?'here':''}">${esc(U(p).name)}</button>`);
  h+=`</div>`;

  if(S.mode==='flows'){
    const fl=flows();
    h+=`<div class="sec">Entry points · ${fl.length}</div>`;
    fl.forEach(f=>{ const u=U(f);
      h+=`<button class="q ${S.flow===f?'sel':''}" data-flow="${f}" style="border-left-color:var(--edge)">
        <div class="qh"><b>${esc(u.name)}</b><em>${u.metrics.hops} hops</em></div>
        <p>${esc((u.semantics?.what||''))}</p></button>`; });
    h+=`<div class="sec">Reading this</div>
      <div class="lg" style="line-height:1.45">Only the units this request actually traverses, in call order. Left bar is the layer it belongs to; the glyph is its complexity. In Delta mode a dot marks a step that changed.</div>`;
  } else if(S.mode==='delta' && IDX.d){
    const q=IDX.d.inspect_queue||[];
    h+=`<div class="sec">Deserves inspection · ${q.length}</div>`;
    q.forEach(x=>{
      const du=IDX.DU[x.unit]; const low=x.confidence<0.7;
      h+=`<button class="q ${S.sel===x.unit?'sel':''} ${low?'lowconf':''}" data-sel="${x.unit}"
           style="border-left-color:var(${rc(x.risk)})">
        <div class="qh"><b><span class="rk">${x.rank}</span>${esc(U(x.unit)?.name||x.qualname)}</b>
        <em>${esc(x.status.replace('_',' '))}</em></div>
        <p>${esc((du?.risk?.why||'').split('. ')[0])}.</p>
        <p style="margin-top:2px"><span class="mt">risk ${x.risk.toFixed(2)} · conf ${x.confidence.toFixed(2)}</span></p>
      </button>`;
    });
    h+=`<div class="sec">Encoding</div>
      <div class="lg"><span class="chip" style="background:var(--added)"></span>added</div>
      <div class="lg"><span class="chip" style="background:var(--modified)"></span>modified · fill = amount</div>
      <div class="lg"><span class="chip" style="background:var(--removed)"></span>removed</div>
      <div class="lg"><span class="chip" style="border:1.5px solid var(--hi)"></span>offset ring = risk ≥ .50</div>
      <div class="lg" style="margin-top:8px;line-height:1.45">Rank is the Interpreter's judgment, not a sort by score. #2 scores below #3 because its blast radius is unobservable.</div>`;
  } else {
    h+=`<div class="sec">Layers</div>`;
    kids(SYS).filter(k=>U(k).kind==='layer').forEach(k=>
      h+=`<div class="lg"><span class="chip" style="background:var(${LC[U(k).qualname]})"></span>${esc(U(k).name)} <span style="margin-left:auto" class="mt">${U(k).metrics.modules}</span></div>`);
    h+=`<div class="sec">Complexity</div>`;
    [[3,'1–2','trivial'],[4,'3–5','ordinary'],[6,'6–12','involved'],[0,'13+','look at this']].forEach(([n,rg,lb])=>{
      h+=`<div class="lg"><svg width="16" height="16" style="flex:none"><polygon points="${ptstr(ngon(8,8,6.5,6.5,n))}" fill="none" stroke="var(--slate)" stroke-width="1.3" stroke-linejoin="round"/></svg>${rg} · ${lb}</div>`;
    });
    h+=`<div class="sec">Trace</div>
      <div class="lg"><span class="chip" style="background:var(--dep)"></span>depends on →</div>
      <div class="lg"><span class="chip" style="background:var(--usr)"></span>used by ←</div>
      <div class="lg" style="margin-top:8px;line-height:1.45">Rows run top to bottom in dependency order — callers above callees. Area is sloc. Nothing here is arbitrary.</div>`;
  }
  r.innerHTML=h;
  r.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{S.focus=b.dataset.go;S.sel=b.dataset.go;S.flow=null;render();});
  r.querySelectorAll('[data-flow]').forEach(b=>b.onclick=()=>{
    const f=b.dataset.flow;
    if(S.mode==='flows'){ S.flow=f; S.sel=f; }
    else { S.flow = S.flow===f ? null : f; S.sel = S.flow||S.focus; S.focus=SYS; }
    render();});
  r.querySelectorAll('[data-sel]').forEach(b=>b.onclick=()=>{
    const id=b.dataset.sel; S.sel=id;
    if(U(id)) { const p=U(id).parent; if(p && !kids(S.focus).includes(id)) S.focus=p; }
    render();
  });
}

/* ── tray ──────────────────────────────────────────────── */
const bar=(v,c)=>`<div class="bar"><div style="width:${Math.round(v*100)}%;background:var(${c})"></div></div>`;

function renderTray(){
  const t=document.getElementById('tray');
  const x=(IDX.ext||[]).find(e=>e.id===S.sel);
  if(x){ t.innerHTML=`<h2>${esc(x.name)}</h2><div class="sub">${esc(x.id)} · ${esc(x.ecosystem)}</div>
    <div class="tags"><span class="tag">depth ${x.depth}</span><span class="tag">${x.direct?'direct':'transitive'}</span></div>
    <div class="sec">Reach</div><div class="kv">
      <span>Version</span><span>${esc(x.version||'unpinned')}</span>
      <span>Call sites</span><span>${(x.reached_by||[]).length}</span>
      <span>Transitive</span><span>${x.transitive_count??'not computed'}</span></div>
    <div class="note"><p>Transitive depth needs a lockfile. <code>requirements.txt</code> pins direct versions only, so depth ≥2 is <b>unavailable</b>, not zero.</p></div>
    <div class="sec">Reached by</div>${(x.reached_by||[]).map(b=>
      `<div class="rel up" data-s="${b}"><span class="ar">←</span>${esc(U(b)?.name||b)}</div>`).join('')}`;
    t.querySelectorAll('[data-s]').forEach(n=>n.onclick=()=>{S.sel=n.dataset.s;renderTray();});
    return;
  }
  const u=U(S.sel); if(!u){ t.innerHTML=`<div class="empty">Nothing selected.</div>`; return; }
  const d=IDX.DU[S.sel], dn=IDX.out[S.sel]||[], up=IDX.inn[S.sel]||[];
  const HOT=['no-fallback','coverage-gap','stale','silent-failure','external-contract','idor-risk','orphan','destructive'];

  let h=`<h2>${esc(u.name)}</h2><div class="sub">${esc(u.id)}<br>${esc(u.kind)}${u.loc?.files?.length?' · '+esc(u.loc.files[0]):''}${u.loc?.start?':'+u.loc.start:''}</div>`;
  if((u.tags||[]).length) h+=`<div class="tags">${u.tags.map(g=>`<span class="tag ${HOT.includes(g)?'hot':''}">${esc(g)}</span>`).join('')}</div>`;

  if(u.signature) h+=`<div class="sec">Signature <span class="src">static</span></div><div class="kv">
    <span>in</span><span>${u.signature.in.length?u.signature.in.map(p=>esc(p.name)+(p.type?': '+esc(p.type):'')).join(', '):'—'}</span>
    <span>out</span><span>${u.signature.out.length?u.signature.out.map(p=>esc(p.type||p.name)).join(', '):'—'}</span>
    ${u.signature.raises?.length?`<span>raises</span><span>${u.signature.raises.map(esc).join(', ')}</span>`:''}
    ${u.signature.async?`<span>async</span><span>yes</span>`:''}</div>`;

  if(u.semantics){
    h+=`<div class="sec">Semantics <span class="src">${esc(u.semantics.source)}</span></div><dl class="w5">
      <dt>what</dt><dd>${esc(u.semantics.what)}</dd><dt>how</dt><dd>${esc(u.semantics.how)}</dd>
      <dt>when</dt><dd>${esc(u.semantics.when)}</dd><dt>where</dt><dd style="font-family:var(--m);font-size:11px">${esc(u.semantics.where)}</dd>
      <dt>why</dt><dd>${esc(u.semantics.why)}</dd></dl>`;
    if(u.semantics.confidence<0.7)
      h+=`<div class="note"><p><b>Confidence ${u.semantics.confidence.toFixed(2)}</b> — this rests on evidence outside the repository. A lead, not a finding.</p></div>`;
  } else {
    h+=`<div class="sec">Semantics</div><div class="empty">Not yet lifted. Structural data only — the Interpreter runs on this unit the first time someone opens it.</div>`;
  }

  h+=`<div class="sec">Metrics</div><div class="kv">
    <span>Lines of code</span><span>${sloc(u)}</span>
    ${u.metrics?.fan_in!=null?`<span>Fan in / out</span><span>${u.metrics.fan_in} / ${u.metrics.fan_out}</span>`:''}
    <span>Complexity</span><span>${cx(u.id)} · ${['circle','','','triangle','square','','hexagon'][SIDES(cx(u.id))]||'circle'}</span>
    ${u.cost?.io?.length?`<span>I/O</span><span>${u.cost.io.join(', ')}</span>`:''}
    ${u.cost?.estimate?`<span>Cost</span><span>${esc(u.cost.estimate)}</span>`:''}
    ${u.metrics?.churn!=null?`<span>Churn</span><span>${u.metrics.churn} lines / ${u.metrics.commits} commits</span>`:''}
    ${u.metrics?.modules!=null?`<span>Modules</span><span>${u.metrics.modules}</span>`:''}</div>`;
  if(u.authors?.length) h+=`<div class="sec">Authors</div><div class="kv">${
    u.authors.map(a=>`<span>${esc(a.name)}</span><span>${a.lines} lines</span>`).join('')}</div>`;

  if(u.kind==='api_flow' && u.steps){
    h+=`<div class="sec">Path · ${u.steps.length} hops</div>`;
    u.steps.forEach((sid,i)=>h+=`<div class="rel dn" data-s="${sid}">
      <span class="ar" style="color:var(--ink)">${i+1}</span>${esc(U(sid)?.name||sid)}
      <span class="ek">${esc(U(sid)?.loc?.files?.[0]?.split('/').pop()||'')}</span></div>`);
  }
  h+=`<div class="sec">Depends on · ${dn.length}</div>`;
  h+= dn.length ? dn.map(e=>`<div class="rel dn" data-s="${e.to}"><span class="ar">→</span>${esc(U(e.to)?.name||e.to)}<span class="ek">${e.kind}${e.weight>1?' ×'+e.weight:''}</span></div>`).join('')
    : `<div class="empty">Nothing. This is a leaf.</div>`;
  h+=`<div class="sec">Used by · ${up.length}</div>`;
  h+= up.length ? up.map(e=>`<div class="rel up" data-s="${e.from}"><span class="ar">←</span>${esc(U(e.from)?.name||e.from)}<span class="ek">${e.kind}${e.weight>1?' ×'+e.weight:''}</span></div>`).join('')
    : `<div class="empty">Nothing. Removing this is free — or it is orphaned.</div>`;

  if(S.mode==='delta'){
    if(d){
      const R=d.risk;
      h+=`<div class="sec">Change · ${DATA.base} → ${DATA.revs[S.rev].sha}</div><div class="kv">
        <span>Status</span><span>${esc(d.status.replace('_',' '))}</span>
        <span>Amount</span><span>${d.amount.toFixed(2)}</span>
        <span>Blast radius</span><span>${d.blast_radius.direct} direct · ${d.blast_radius.transitive} transitive</span>
        <span>Public API</span><span>${d.blast_radius.public_api?'yes':'no'}</span>
        <span>Fields</span><span>${d.fields.map(esc).join(', ')||'—'}</span></div>`;
      if(R.axes){
        h+=`<div class="sec">Risk · ${R.score.toFixed(2)} <span class="src">${esc(R.source)}</span></div><div class="ax">`;
        ['functionality','availability','scalability','performance','security'].forEach(k=>
          h+=`<i>${k}</i>${bar(R.axes[k],rc(R.axes[k]))}<b>${R.axes[k].toFixed(2)}</b>`);
        h+=`</div><p style="margin:10px 0 0;font-size:11.5px">${esc(R.why)}</p>
          <div class="note" style="border-left-color:var(${rc(1-R.confidence)})">
          <p><b>Confidence ${R.confidence.toFixed(2)}</b> · rank ${R.rank} · formula floor ${R.formula_floor.toFixed(2)} · ground truth <span style="font-family:var(--m)">${esc(R.ground_truth)}</span></p></div>`;
      } else {
        h+=`<div class="sec">Risk · ${R.score.toFixed(2)} <span class="src">formula</span></div>
          <div class="empty">No narration — this unit's semantic hash did not change, so Pass D did not run on it. Score is the formula floor.</div>`;
      }
    } else {
      const roll=IDX.RU[S.sel];
      h+=`<div class="sec">Change</div>`;
      h+= roll && roll.amount>0
        ? `<div class="kv"><span>Rolled-up amount</span><span>${roll.amount.toFixed(3)}</span>
           <span>Rolled-up risk</span><span>${roll.risk.toFixed(2)}</span>
           <span>Subtree sloc</span><span>${roll.sloc}</span></div>
           <div class="empty" style="margin-top:8px">Unchanged itself. These numbers come from descendants — drill in.</div>`
        : `<div class="empty">Unchanged between ${cmpFrom()} and ${DATA.revs[S.rev].sha}.</div>`;
    }
  }
  t.innerHTML=h;
  t.querySelectorAll('[data-s]').forEach(n=>n.onclick=()=>{S.sel=n.dataset.s;renderTray();});
}

/* ── timeline ──────────────────────────────────────────── */
function renderTL(){
  const r=document.getElementById('revs'), mx=Math.max(...DATA.revs.map(v=>v.amount||0),.01);
  r.innerHTML=DATA.revs.map((v,i)=>{
    const cl=['rev',i===S.rev?'on':'',i<S.rev?'past':'',i===0?'base':'',v.author_kind==='human'?'human':''].join(' ');
    return `<div class="${cl}" data-r="${i}" title="${esc(v.message)}">
      <div class="amt" style="height:${Math.round((v.amount||0)/mx*30)}px"></div>
      <div class="dot"></div><div class="cap">${v.sha}</div></div>`;
  }).join('');
  r.querySelectorAll('[data-r]').forEach(n=>n.onclick=()=>{S.rev=+n.dataset.r;render();});
  const v=DATA.revs[S.rev];
  document.getElementById('tlm').innerHTML=`<b>${esc(v.message)}</b>${esc(v.author)} · ${esc(v.author_kind)}`;
  document.getElementById('revlbl').textContent=v.sha;
}

/* ── modes ─────────────────────────────────────────────── */
function setMode(m){
  S.mode=m;
  const show = m==='delta' ? '' : 'none';
  document.getElementById('cmp').style.display=show;
  document.getElementById('cmplb').style.display=show;
  if(m==='flows' && !S.flow) S.flow=flows()[0];
  document.querySelectorAll('#mode button').forEach(b=>b.classList.toggle('on',b.dataset.m===m));
  if(m==='delta' && IDX.d?.inspect_queue?.length && !IDX.DU[S.sel]) S.sel=IDX.d.inspect_queue[0].unit;
  if(m==='ext') S.sel=(IDX.ext[0]||{}).id;
  if(m!=='ext' && String(S.sel).startsWith('x:')) S.sel=S.focus;
  render();
}
document.querySelectorAll('#mode button').forEach(b=>b.onclick=()=>setMode(b.dataset.m));
document.querySelectorAll('#cmp button').forEach(b=>b.onclick=()=>{
  S.cmp=b.dataset.c;
  document.querySelectorAll('#cmp button').forEach(o=>o.classList.toggle('on',o.dataset.c===S.cmp));
  render();
});
document.querySelectorAll('#skin button').forEach(b=>b.onclick=()=>{
  S.skin=b.dataset.s;
  document.querySelectorAll('#skin button').forEach(o=>o.classList.toggle('on',o.dataset.s===S.skin));
  draw();
});
document.getElementById('play').onclick=function(){
  if(S.play){ clearInterval(S.play); S.play=0; this.textContent='▶'; return; }
  this.textContent='❚❚';
  if(S.mode!=='delta') setMode('delta');
  S.rev=0; render();
  S.play=setInterval(()=>{
    if(S.rev>=DATA.revs.length-1){ clearInterval(S.play); S.play=0;
      document.getElementById('play').textContent='▶'; return; }
    S.rev++; render();
  },1250);
};

function render(){
  reindex();
  if(!U(S.focus)) S.focus=SYS;
  if(!U(S.sel) && !String(S.sel).startsWith('x:')) S.sel=S.focus;
  draw(); renderRail(); renderTray(); renderTL();
}
addEventListener('resize',()=>draw());
setTimeout(render,50);
</script>
"""


if __name__ == "__main__":
    store = Path(sys.argv[1])
    out = Path(sys.argv[2])
    payload = load(store)
    repo = payload["snapshots"][payload["base"]]["repo"]["root"]
    html = HTML.replace("__DATA__", json.dumps(payload, separators=(",", ":"))) \
               .replace("__REPO__", repo)
    out.write_text(html)
    print(f"{out}: {len(html)/1024:.0f} KB · {len(payload['revs'])} revs · "
          f"{sum(len(s['units']) for s in payload['snapshots'].values())} units total")

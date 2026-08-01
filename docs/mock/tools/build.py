#!/usr/bin/env python3
"""
scv build — runs the full pipeline for the orderly fixture.

  extract(rev)  ->  SymbolGraph          (deterministic, tools/extract.py)
  interpret     ->  UnitGraph / snapshot (semantics + clustering, tools/interpret.json)
  diff(a,b)     ->  DeltaGraph           (hash-driven, LLM only for risk narration)

Usage:  python3 tools/build.py <repo> <out-dir>
"""
from __future__ import annotations
import json, sys, hashlib
from pathlib import Path
from extract import extract, h

REVS = [
    ("6ab4e5e", "baseline"), ("731c3e3", "agent"), ("a06810c", "agent"),
    ("57be285", "agent"), ("42406d1", "agent"), ("bed04b3", "human"),
    ("bc3450f", "fixture"),   # HEAD: adds migrations/, scripts/, admin_tasks shim
]

LAYER_ORDER = ["edge", "domain", "infra", "support", "ops", "tests"]


# ── interpret: SymbolGraph -> UnitGraph ──────────────────────────────────
def interpret(snap: dict, I: dict) -> dict:
    units = {u["id"]: u for u in snap["units"]}
    qual2id = {u["qualname"]: u["id"] for u in snap["units"]}

    # attach semantics to leaf + module units
    for u in snap["units"]:
        s = I["units"].get(u["qualname"])
        if s:
            u["semantics"] = {k: s[k] for k in ("what", "how", "when", "where", "why")}
            u["semantics"]["confidence"] = s["confidence"]
            u["semantics"]["source"] = "llm"
            u["tags"] = s.get("tags", [])
            if "cost_estimate" in s:
                u.setdefault("cost", {})["estimate"] = s["cost_estimate"]
                u["cost"]["confidence"] = min(u["cost"].get("confidence", 0.9), s["confidence"])
        else:
            u["semantics"] = None      # not yet lifted; lazy
            u.setdefault("tags", [])
        u["hash"]["semantic"] = h(json.dumps(u.get("semantics"), sort_keys=True)) \
            if u.get("semantics") else None

    new_units = []

    # layer units (Pass B output)
    sysid = "u:sys:orderly"
    layer_ids = []
    for key in LAYER_ORDER:
        c = I["clusters"].get(key)
        if not c:
            continue
        members = [qual2id[m] for m in c["modules"] if m in qual2id]
        if not members:
            continue
        lid = f"u:layer:{key}"
        layer_ids.append(lid)
        for m in members:
            units[m]["parent"] = lid
        new_units.append({
            "id": lid, "kind": "layer", "name": c["name"], "qualname": key, "lang": "python",
            "parent": sysid, "children": members,
            "loc": {"files": sorted({f for m in members for f in units[m]["loc"]["files"]}),
                    "start": None, "end": None,
                    "sloc": sum(units[m]["loc"]["sloc"] for m in members)},
            "semantics": {k: c[k] for k in ("what", "how", "when", "where", "why")}
                         | {"confidence": c["confidence"], "source": "llm"},
            "tags": c["tags"],
            "metrics": {"sloc": sum(units[m]["metrics"]["sloc"] for m in members),
                        "modules": len(members)},
            "hash": {"struct": h("".join(sorted(members)))},
            "provenance": {"source": "llm", "pass": "B"},
        })

    # api_flow units (Pass C output)
    flow_ids = []
    for f in I["api_flows"]:
        steps = [qual2id[s] for s in f["steps"] if s in qual2id]
        fid = "u:flow:" + h(f["route"], 8)
        flow_ids.append(fid)
        new_units.append({
            "id": fid, "kind": "api_flow", "name": f["name"], "qualname": f["route"],
            "lang": "python", "parent": sysid, "children": [],
            "route": f["route"], "steps": steps,
            "loc": {"files": sorted({units[s]["loc"]["files"][0] for s in steps}),
                    "sloc": sum(units[s]["loc"]["sloc"] for s in steps)},
            "semantics": {k: f[k] for k in ("what", "how", "when", "where", "why")}
                         | {"confidence": f["confidence"], "source": "llm"},
            "tags": f["tags"],
            "metrics": {"hops": len(steps),
                        "sloc": sum(units[s]["loc"]["sloc"] for s in steps)},
            "hash": {"struct": h("".join(steps))},
            "provenance": {"source": "llm", "pass": "C"},
        })

    # system unit
    sysc = I["system"]
    new_units.append({
        "id": sysid, "kind": "system", "name": sysc["name"], "qualname": sysc["name"],
        "lang": "python", "parent": None, "children": layer_ids + flow_ids,
        "loc": {"files": sorted({f for u in snap["units"] for f in u["loc"]["files"]}),
                "sloc": sum(u["loc"]["sloc"] for u in snap["units"] if u["kind"] == "module")},
        "semantics": {k: sysc[k] for k in ("what", "how", "when", "where", "why")}
                     | {"confidence": sysc["confidence"], "source": "llm"},
        "tags": sysc["tags"],
        "metrics": {"sloc": sum(u["loc"]["sloc"] for u in snap["units"] if u["kind"] == "module"),
                    "modules": sum(1 for u in snap["units"] if u["kind"] == "module"),
                    "layers": len(layer_ids)},
        "hash": {"struct": h("".join(sorted(layer_ids)))},
        "provenance": {"source": "llm", "pass": "C"},
    })

    # lift edges to layer level
    lay_of = {}
    for nu in new_units:
        if nu["kind"] == "layer":
            for m in nu["children"]:
                lay_of[m] = nu["id"]
    agg = {}
    for e in snap["edges"]:
        a = lay_of.get(units[e["from"]].get("parent", e["from"]), None) \
            or lay_of.get(e["from"])
        b = lay_of.get(units[e["to"]].get("parent", e["to"]), None) or lay_of.get(e["to"])
        if a and b and a != b:
            k = (a, b, e["kind"])
            agg[k] = agg.get(k, 0) + e["weight"]
    for (a, b, k), w in sorted(agg.items()):
        snap["edges"].append({
            "id": f"e:{h(a + b + k, 10)}", "from": a, "to": b, "kind": k, "weight": w,
            "evidence": [], "source": "static", "confidence": 1.0, "rollup": True,
        })

    snap["units"].extend(new_units)
    snap["units"].sort(key=lambda u: (u["kind"] != "system", u["kind"] != "layer", u["id"]))
    snap["provenance"]["interpreter"] = {"model": I["model"], "prompt_rev": I["prompt_rev"]}
    return snap


# ── diff ─────────────────────────────────────────────────────────────────
def blast(units, edges, uid, cap=4):
    inc = {}
    for e in edges:
        inc.setdefault(e["to"], []).append(e["from"])
    seen, frontier, direct = set(), [uid], len(inc.get(uid, []))
    for _ in range(cap):
        nxt = []
        for n in frontier:
            for p in inc.get(n, []):
                if p not in seen:
                    seen.add(p)
                    nxt.append(p)
        frontier = nxt
        if not frontier:
            break
    return {"direct": direct, "transitive": len(seen)}


def diff(a: dict, b: dict, I: dict) -> dict:
    A = {u["id"]: u for u in a["units"]}
    B = {u["id"]: u for u in b["units"]}
    q2id = {u["qualname"]: u["id"] for u in b["units"]}
    risk_by_qual = I["risk"]

    deltas = []
    for uid in sorted(set(A) | set(B)):
        ua, ub = A.get(uid), B.get(uid)
        u = ub or ua
        if ua and not ub:
            status, amount = "removed", 1.0
            fields = ["removed"]
        elif ub and not ua:
            status, amount = "added", 1.0
            fields = ["added"]
        else:
            ht_a, ht_b = ua["hash"].get("text"), ub["hash"].get("text")
            hs_a, hs_b = ua["hash"].get("struct"), ub["hash"].get("struct")
            hm_a, hm_b = ua["hash"].get("semantic"), ub["hash"].get("semantic")
            text_ch, struct_ch, sem_ch = ht_a != ht_b, hs_a != hs_b, hm_a != hm_b
            fields = ([f"hash.text"] if text_ch else []) + \
                     ([f"hash.struct"] if struct_ch else []) + \
                     ([f"semantics"] if sem_ch else [])
            if not (text_ch or struct_ch or sem_ch):
                status, amount = "unchanged", 0.0
            else:
                status = "modified"
                da = abs(ub["loc"]["sloc"] - ua["loc"]["sloc"]) / max(ua["loc"]["sloc"], 1)
                amount = round(min(1.0, 0.4 * min(da + 0.3 * text_ch, 1.0)
                                   + 0.3 * struct_ch + 0.3 * sem_ch), 3)

        qual = u["qualname"]
        r = risk_by_qual.get(qual)
        if status == "unchanged" and not (r and r.get("risk_only")):
            continue

        br = blast(B, b["edges"], uid) if ub else blast(A, a["edges"], uid)
        pub = "public-api" in (u.get("tags") or []) or "auth-boundary" in (u.get("tags") or [])
        floor = round(min(1.0, amount * (0.5 + 0.5 * min(br["transitive"] / 12, 1.0))
                          * (1.4 if pub else 1.0)), 3)

        d = {
            "unit": uid, "qualname": qual, "kind": u["kind"], "status": status,
            "fields": fields, "amount": amount,
            "blast_radius": {**br, "public_api": pub},
            "authors": u.get("authors", []),
            "risk": {"score": floor, "source": "formula", "confidence": 0.5,
                     "axes": None, "why": None},
        }
        if r:
            d["risk"] = {
                "score": round(max(r["axes"].values()), 3),
                "axes": r["axes"], "why": r["why"],
                "confidence": r["confidence"], "source": "llm",
                "formula_floor": floor, "rank": r["rank"], "ground_truth": r["gt"],
            }
            if r.get("risk_only"):
                d["status"] = "risk_changed"
        deltas.append(d)

    ranked = sorted([d for d in deltas if d["risk"].get("rank")],
                    key=lambda d: d["risk"]["rank"])
    for i, d in enumerate(deltas, 1):
        d.setdefault("_", None)

    # edge deltas
    ea = {e["id"]: e for e in a["edges"]}
    eb = {e["id"]: e for e in b["edges"]}
    edge_deltas = [{"edge": k, "from": (eb.get(k) or ea[k])["from"],
                    "to": (eb.get(k) or ea[k])["to"],
                    "kind": (eb.get(k) or ea[k])["kind"],
                    "status": "added" if k not in ea else "removed" if k not in eb
                    else "reweighted"}
                   for k in sorted(set(ea) | set(eb))
                   if k not in ea or k not in eb or ea[k]["weight"] != eb[k]["weight"]]

    # rollup: parent amount = sloc-weighted mean of children, risk = max, damped by fan-in
    byid = {u["id"]: u for u in b["units"]}
    dmap = {d["unit"]: d for d in deltas}
    rollup = {}

    def roll(uid):
        u = byid.get(uid)
        if not u:
            return (0.0, 0.0, 0)
        kids = u.get("children") or []
        if not kids:
            d = dmap.get(uid)
            return (d["amount"] if d else 0.0, d["risk"]["score"] if d else 0.0,
                    u["loc"]["sloc"])
        tot_a = tot_s = 0.0
        mx = 0.0
        for k in kids:
            a_, r_, s_ = roll(k)
            tot_a += a_ * s_
            tot_s += s_
            mx = max(mx, r_)
        own = dmap.get(uid)
        if own:
            tot_a += own["amount"] * u["loc"]["sloc"]
            tot_s += u["loc"]["sloc"]
            mx = max(mx, own["risk"]["score"])
        amt = round(tot_a / tot_s, 3) if tot_s else 0.0
        rollup[uid] = {"amount": amt, "risk": round(mx, 3), "sloc": tot_s}
        return (amt, mx, tot_s)

    roll("u:sys:orderly")

    return {
        "schema": "scv-delta/1",
        "from": {"snapshot_id": a["snapshot_id"], "sha": a["rev"]["sha"]},
        "to": {"snapshot_id": b["snapshot_id"], "sha": b["rev"]["sha"]},
        "provenance": {**b["provenance"],
                       "formulas": {
                           "amount": "0.4*text_diff + 0.3*struct_changed + 0.3*semantic_drift",
                           "risk_floor": "amount * (0.5 + 0.5*norm(blast.transitive)) * boost(public_api)",
                           "rollup_amount": "sloc-weighted mean of children",
                           "rollup_risk": "max of children"}},
        "inspect_queue": [{"rank": d["risk"]["rank"], "unit": d["unit"],
                           "qualname": d["qualname"], "status": d["status"],
                           "risk": d["risk"]["score"], "confidence": d["risk"]["confidence"],
                           "ground_truth": d["risk"]["ground_truth"]} for d in ranked],
        "unit_deltas": deltas,
        "edge_deltas": edge_deltas,
        "rollup": rollup,
    }


# ── main ─────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    repo, out = sys.argv[1], Path(sys.argv[2])
    I = json.loads(Path(__file__).with_name("interpret.json").read_text())
    (out / "snapshots").mkdir(parents=True, exist_ok=True)
    (out / "deltas").mkdir(parents=True, exist_ok=True)

    snaps = {}
    for sha, who in REVS:
        s = interpret(extract(repo, sha), I)
        s["rev"]["author_kind"] = who
        snaps[sha] = s
        p = out / "snapshots" / f"{sha}.json"
        p.write_text(json.dumps(s, indent=2))
        print(f"  snapshot {sha}  {len(s['units']):3d} units  {len(s['edges']):3d} edges")

    base, head = REVS[0][0], REVS[-1][0]
    for (a, _), (b, _) in zip(REVS, REVS[1:]):          # step: rev vs its parent
        sd = diff(snaps[a], snaps[b], I)
        (out / "deltas" / f"{a}__{b}.json").write_text(json.dumps(sd, indent=2))
    for sha, _ in REVS[1:]:                              # cumulative: rev vs base
        d = diff(snaps[base], snaps[sha], I)
        (out / "deltas" / f"{base}__{sha}.json").write_text(json.dumps(d, indent=2))
    d = diff(snaps[base], snaps[head], I)
    print(f"  delta {base}..{head}  {len(d['unit_deltas'])} unit deltas, "
          f"{len(d['edge_deltas'])} edge deltas, queue of {len(d['inspect_queue'])}")
    print(f"  + {len(REVS)-1} cumulative and {len(REVS)-1} step deltas")

#!/usr/bin/env python3
"""
Generic variant of render.py's load() for a real .scv/ store with an arbitrary
set of snapshot shas (not the orderly fixture's hardcoded REV_ORDER).
Discovers snapshots from <store>/snapshots/*.json, sorted by rev.ts, and picks up
deltas from <store>/deltas/*.json if present. Reuses render.py's HTML template
and prune() by importing the module directly.

Usage: python3 render_generic.py <.scv dir> <out.html>
"""
from __future__ import annotations
import importlib.util
import json
import sys
from pathlib import Path

MOCK_RENDER = Path(__file__).resolve().parent / "render.py"

spec = importlib.util.spec_from_file_location("mock_render", MOCK_RENDER)
mock_render = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mock_render)


def load(store: Path) -> dict:
    snaps_dir = store / "snapshots"
    shas = [p.stem for p in sorted(snaps_dir.glob("*.json"))]
    snaps = {sha: mock_render.prune(json.loads((snaps_dir / f"{sha}.json").read_text())) for sha in shas}
    shas.sort(key=lambda s: snaps[s]["rev"]["ts"])
    base = shas[0]

    deltas = {}
    deltas_dir = store / "deltas"
    if deltas_dir.exists():
        for i, sha in enumerate(shas):
            if not i:
                continue
            for frm in dict.fromkeys([base, shas[i - 1]]):
                p = deltas_dir / f"{frm}__{sha}.json"
                if p.exists():
                    deltas[f"{frm}__{sha}"] = json.loads(p.read_text())

    revs = [
        {"sha": s, **{k: snaps[s]["rev"].get(k) for k in ("author", "ts", "message", "author_kind")}}
        for s in shas
    ]
    for r in revs:
        d = deltas.get(f"{base}__{r['sha']}")
        roll = (d or {}).get("rollup", {}).get(f"u:sys:{snaps[base]['repo']['root']}", {})
        r["amount"] = roll.get("amount", 0)
        r["risk"] = roll.get("risk", 0)
    return {"base": base, "revs": revs, "snapshots": snaps, "deltas": deltas}


if __name__ == "__main__":
    store = Path(sys.argv[1])
    out = Path(sys.argv[2])
    payload = load(store)
    repo = payload["snapshots"][payload["base"]]["repo"]["root"]
    html = (
        mock_render.HTML.replace("__DATA__", json.dumps(payload, separators=(",", ":")))
        .replace("__REPO__", repo)
        .replace("'u:sys:orderly'", json.dumps(f"u:sys:{repo}"))
    )
    out.write_text(html)
    print(
        f"{out}: {len(html)/1024:.0f} KB . {len(payload['revs'])} revs . "
        f"{sum(len(s['units']) for s in payload['snapshots'].values())} units total"
    )

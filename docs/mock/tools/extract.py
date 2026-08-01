#!/usr/bin/env python3
"""
scv extractor — deterministic pass. No LLM.

Reads a repo at a git rev, emits a SymbolGraph:
  units  (module + function + class, with loc/sloc/signature/hashes)
  edges  (imports, calls, resolved within the repo)
  externals (from requirements.txt, with reached_by)
  vcs    (churn + authors per file)

Python-only stand-in for the tree-sitter host. Same output contract.
"""
from __future__ import annotations
import ast, hashlib, json, os, subprocess, sys, tarfile, tempfile, io
from pathlib import Path

SKIP_DIRS = {"__pycache__", ".git", ".scv"}


# ── helpers ──────────────────────────────────────────────────────────────
def sh(*args, cwd=None) -> str:
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=True).stdout


def h(s: str, n: int = 12) -> str:
    return hashlib.sha1(s.encode()).hexdigest()[:n]


def checkout(repo: str, rev: str, dest: str) -> None:
    """Materialise the tree at `rev` into `dest` without touching the worktree."""
    blob = subprocess.run(["git", "archive", rev], cwd=repo, capture_output=True, check=True).stdout
    with tarfile.open(fileobj=io.BytesIO(blob)) as tf:
        tf.extractall(dest)


def py_files(root: str):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith("._")]
        for fn in sorted(filenames):
            if fn.endswith(".py") and not fn.startswith("._"):
                yield os.path.relpath(os.path.join(dirpath, fn), root)


def modname(rel: str) -> str:
    m = rel[:-3].replace(os.sep, ".")
    return m[: -len(".__init__")] if m.endswith(".__init__") else m


def sloc(src: str) -> int:
    """Non-blank, non-comment lines."""
    n = 0
    for ln in src.splitlines():
        s = ln.strip()
        if s and not s.startswith("#"):
            n += 1
    return n


def normalize(src: str) -> str:
    """Comment- and blank-insensitive text, so reformatting alone is not a text delta."""
    out = []
    for ln in src.splitlines():
        s = ln.split("#", 1)[0].rstrip()
        if s.strip():
            out.append(" ".join(s.split()))
    return "\n".join(out)


def complexity(node: ast.AST) -> int:
    """Cyclomatic-ish: decision points + 1."""
    c = 1
    for n in ast.walk(node):
        if isinstance(n, (ast.If, ast.For, ast.While, ast.ExceptHandler,
                          ast.With, ast.Assert, ast.comprehension)):
            c += 1
        elif isinstance(n, ast.BoolOp):
            c += len(n.values) - 1
    return c


IO_HINTS = {
    "redis": "redis", "execute": "db", "fetch_one": "db", "fetch": "db",
    "environ": "env", "getenv": "env", "get_logger": "stdout", "info": "stdout",
    "post": "net", "get": "net", "request": "net", "APIRouter": "net",
}


# ── extraction ───────────────────────────────────────────────────────────
class Extractor:
    def __init__(self, root: str, rev: str):
        self.root, self.rev = root, rev
        self.units: dict[str, dict] = {}
        self.edges: list[dict] = []
        self.defs: dict[str, str] = {}       # "mod.func" -> unit id
        self.imports: dict[str, dict] = {}   # module -> {localname: target}
        self.ext_imports: dict[str, set] = {}  # module -> {"redis", ...}

    # pass 1 ─ definitions
    def scan(self):
        for rel in py_files(self.root):
            src = Path(self.root, rel).read_text(encoding="utf-8", errors="replace")
            try:
                tree = ast.parse(src)
            except SyntaxError:
                continue
            mod = modname(rel)
            mid = f"u:py:{mod}#m"
            lines = src.splitlines()
            self.units[mid] = {
                "id": mid, "kind": "module", "name": mod.split(".")[-1], "qualname": mod,
                "lang": "python", "parent": None, "children": [],
                "loc": {"files": [rel], "start": 1, "end": len(lines), "sloc": sloc(src)},
                "metrics": {"sloc": sloc(src), "fan_in": 0, "fan_out": 0},
                "hash": {"text": h(normalize(src))},
                "provenance": {"source": "static"},
            }
            self.imports[mod] = {}
            self.ext_imports[mod] = set()
            self._walk_module(tree, mod, mid, src, lines)

    def _walk_module(self, tree, mod, mid, src, lines):
        for node in tree.body:
            # imports
            if isinstance(node, ast.Import):
                for a in node.names:
                    self.imports[mod][a.asname or a.name.split(".")[0]] = a.name
            elif isinstance(node, ast.ImportFrom) and node.module:
                for a in node.names:
                    self.imports[mod][a.asname or a.name] = f"{node.module}.{a.name}"

            # defs
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                self.units[mid]["children"].append(self._def(node, mod, mid, lines))

    def _def(self, node, mod, parent_id, lines, prefix="", mid=None):
        mid = mid or parent_id
        qual = f"{mod}.{prefix}{node.name}"
        kind = "class" if isinstance(node, ast.ClassDef) else "function"
        uid = f"u:py:{qual}#{'c' if kind == 'class' else 'f'}"
        start, end = node.lineno, getattr(node, "end_lineno", node.lineno)
        body = "\n".join(lines[start - 1:end])

        sig = None
        if kind == "function":
            args = node.args
            ports_in = []
            for a in args.args + args.kwonlyargs:
                ports_in.append({"name": a.arg,
                                 "type": ast.unparse(a.annotation) if a.annotation else None,
                                 "source": "static"})
            if args.vararg:
                ports_in.append({"name": "*" + args.vararg.arg, "type": None, "source": "static"})
            raises = sorted({ast.unparse(n.exc).split("(")[0]
                             for n in ast.walk(node)
                             if isinstance(n, ast.Raise) and n.exc})
            sig = {
                "in": ports_in,
                "out": ([{"name": "return", "type": ast.unparse(node.returns), "source": "static"}]
                        if node.returns else []),
                "raises": raises,
                "async": isinstance(node, ast.AsyncFunctionDef),
            }

        io = sorted({v for k, v in IO_HINTS.items() if k in body})
        self.units[uid] = {
            "id": uid, "kind": kind, "name": node.name, "qualname": qual, "lang": "python",
            "parent": parent_id, "children": [],
            "loc": {"files": self.units[mid]["loc"]["files"], "start": start, "end": end,
                    "sloc": sloc(body)},
            "signature": sig,
            "cost": {"complexity": complexity(node), "io": io,
                     "confidence": 0.9, "source": "static"},
            "metrics": {"sloc": sloc(body), "fan_in": 0, "fan_out": 0},
            "hash": {"text": h(normalize(body)),
                     "struct": h(json.dumps(sig, sort_keys=True)) if sig else None},
            "provenance": {"source": "static"},
        }
        self.defs[qual] = uid

        for sub in node.body:
            if isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                self.units[uid]["children"].append(
                    self._def(sub, mod, uid, lines, prefix=f"{prefix}{node.name}.", mid=mid))
        return uid

    # pass 2 ─ references
    def resolve(self):
        known_mods = {u["qualname"] for u in self.units.values() if u["kind"] == "module"}

        for rel in py_files(self.root):
            src = Path(self.root, rel).read_text(encoding="utf-8", errors="replace")
            try:
                tree = ast.parse(src)
            except SyntaxError:
                continue
            mod = modname(rel)
            mid = f"u:py:{mod}#m"
            imap = self.imports[mod]

            # import edges
            for local, target in imap.items():
                tmod = target
                while tmod and tmod not in known_mods:
                    tmod = tmod.rsplit(".", 1)[0] if "." in tmod else ""
                if tmod:
                    self._edge(mid, f"u:py:{tmod}#m", "imports", rel, 1, 1.0)
                else:
                    self.ext_imports[mod].add(target.split(".")[0])

            # call edges, attributed to the enclosing def
            owner_stack = []

            class V(ast.NodeVisitor):
                def __init__(v, outer):
                    v.o = outer

                def _enter(v, node, kindchar):
                    qual_parts = [p for p in owner_stack]
                    qual = ".".join([mod] + qual_parts + [node.name])
                    owner_stack.append(node.name)
                    v.generic_visit(node)
                    owner_stack.pop()

                visit_FunctionDef = lambda v, n: v._enter(n, "f")
                visit_AsyncFunctionDef = lambda v, n: v._enter(n, "f")
                visit_ClassDef = lambda v, n: v._enter(n, "c")

                def visit_Call(v, node):
                    src_qual = ".".join([mod] + owner_stack) if owner_stack else mod
                    src_id = v.o.defs.get(src_qual, mid)
                    tgt = v.o._target(node.func, mod, imap, known_mods)
                    if tgt and tgt != src_id:
                        v.o._edge(src_id, tgt, "calls", rel, node.lineno, 1.0)
                    v.generic_visit(node)

            V(self).visit(tree)

    def _target(self, func, mod, imap, known_mods):
        """Resolve a call target to a unit id, or None."""
        if isinstance(func, ast.Name):
            name = func.id
            if f"{mod}.{name}" in self.defs:
                return self.defs[f"{mod}.{name}"]
            if name in imap and imap[name] in self.defs:
                return self.defs[imap[name]]
            return None
        if isinstance(func, ast.Attribute):
            base = func.value
            if isinstance(base, ast.Name):
                root = imap.get(base.id, base.id)
                cand = f"{root}.{func.attr}"
                if cand in self.defs:
                    return self.defs[cand]
                if root in known_mods:
                    return f"u:py:{root}#m"
            return None
        return None

    def _edge(self, a, b, kind, file, line, conf):
        for e in self.edges:
            if e["from"] == a and e["to"] == b and e["kind"] == kind:
                e["weight"] += 1
                e["evidence"].append({"file": file, "line": line})
                return
        self.edges.append({
            "id": f"e:{h(a + b + kind, 10)}", "from": a, "to": b, "kind": kind,
            "weight": 1, "evidence": [{"file": file, "line": line}],
            "source": "static", "confidence": conf,
        })

    # pass 3 ─ metrics + externals + vcs
    def finish(self, repo: str):
        for e in self.edges:
            if e["from"] in self.units:
                self.units[e["from"]]["metrics"]["fan_out"] += 1
            if e["to"] in self.units:
                self.units[e["to"]]["metrics"]["fan_in"] += 1

        # struct hash for modules = signatures of children + outgoing edges
        for u in self.units.values():
            if u["kind"] == "module":
                sig = [self.units[c]["hash"].get("struct") for c in u["children"]]
                out = sorted(e["to"] + e["kind"] for e in self.edges if e["from"] == u["id"])
                u["hash"]["struct"] = h(json.dumps([sig, out], sort_keys=True))

        # externals
        reqs = Path(self.root, "requirements.txt")
        pinned = {}
        if reqs.exists():
            for ln in reqs.read_text().splitlines():
                if "==" in ln:
                    n, v = ln.strip().split("==")
                    pinned[n] = v
        externals = {}
        for mod, names in self.ext_imports.items():
            for n in names:
                if n in ("os", "sys", "time", "json", "typing", "dataclasses", "pathlib",
                         "hashlib", "asyncio", "collections", "functools", "re", "abc"):
                    continue
                xid = f"x:pypi:{n}" + (f"@{pinned[n]}" if n in pinned else "")
                x = externals.setdefault(xid, {
                    "id": xid, "ecosystem": "pypi", "name": n,
                    "version": pinned.get(n), "direct": n in pinned,
                    "depth": 1, "reached_by": [], "transitive_count": None,
                    "source": "static",
                })
                x["reached_by"].append(f"u:py:{mod}#m")

        # vcs
        vcs = {}
        log = sh("git", "log", "--format=%H|%an", "--numstat", self.rev, cwd=repo)
        author, cur = None, None
        for ln in log.splitlines():
            if "|" in ln and "\t" not in ln:
                cur, author = ln.split("|", 1)
            elif "\t" in ln:
                add, dele, path = ln.split("\t")
                if add == "-":
                    continue
                v = vcs.setdefault(path, {"commits": 0, "added": 0, "deleted": 0, "authors": {}})
                v["commits"] += 1
                v["added"] += int(add)
                v["deleted"] += int(dele)
                v["authors"][author] = v["authors"].get(author, 0) + int(add)

        for u in self.units.values():
            f = u["loc"]["files"][0]
            if f in vcs:
                u["metrics"]["churn"] = vcs[f]["added"] + vcs[f]["deleted"]
                u["metrics"]["commits"] = vcs[f]["commits"]
                u["authors"] = [{"name": k, "lines": v}
                                for k, v in sorted(vcs[f]["authors"].items(),
                                                   key=lambda kv: -kv[1])]

        return sorted(externals.values(), key=lambda x: x["id"])


def extract(repo: str, rev: str) -> dict:
    with tempfile.TemporaryDirectory() as td:
        checkout(repo, rev, td)
        ex = Extractor(td, rev)
        ex.scan()
        ex.resolve()
        externals = ex.finish(repo)
    sha = sh("git", "rev-parse", "--short", rev, cwd=repo).strip()
    meta = sh("git", "log", "-1", "--format=%an|%aI|%s", rev, cwd=repo).strip().split("|", 2)
    return {
        "schema": "scv/1",
        "snapshot_id": h(f"{repo}@{sha}", 16),
        "repo": {"root": os.path.basename(os.path.abspath(repo)), "vcs": "git"},
        "rev": {"sha": sha, "kind": "commit", "author": meta[0], "ts": meta[1], "message": meta[2]},
        "provenance": {"extractor": "scv-py/0.1.0", "interpreter": None},
        "units": sorted(ex.units.values(), key=lambda u: u["id"]),
        "edges": sorted(ex.edges, key=lambda e: (e["from"], e["to"], e["kind"])),
        "externals": externals,
    }


if __name__ == "__main__":
    repo, rev = sys.argv[1], sys.argv[2]
    out = extract(repo, rev)
    dest = sys.argv[3] if len(sys.argv) > 3 else "-"
    js = json.dumps(out, indent=2)
    if dest == "-":
        print(js)
    else:
        Path(dest).parent.mkdir(parents=True, exist_ok=True)
        Path(dest).write_text(js)
        u, e = len(out["units"]), len(out["edges"])
        print(f"{dest}: {u} units, {e} edges, {len(out['externals'])} externals")

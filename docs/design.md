# scv — semantic code visualizer

A multi-view visualizer for software projects. It answers two questions:

- **What exists?** — the structure of a codebase at any point in its history, from the whole system down to a single function, with each level explained in the same vocabulary.
- **What changed, and what deserves a human?** — what moved between two revisions, who moved it, how much, and what it puts at risk.

The first question is the bulk of the product. The second is what makes people open it on a Tuesday.

## Documents

| | |
|---|---|
| [`analyze.md`](analyze.md) | What analysis produces and why — units, edges, semantics, deltas, risk |
| [`serve.md`](serve.md) | What the visualizer shows and how it behaves |
| [`implement-analyze.md`](implement-analyze.md) | Analyzer stack, module layout, milestones |
| [`implement-serve.md`](implement-serve.md) | Visualizer stack, module layout, milestones |
| [`mock/`](mock/README.md) | Working prototype — runs the whole pipeline on one fixture and renders it |
| [`llm-call-observability.md`](llm-call-observability.md) | Future work — per-call token/cost logging, file-duplication detection |

## Fixed decisions

| Decision | Choice |
|---|---|
| Languages analyzed | Polyglot from day one — tree-sitter grammar per language, one uniform IR |
| Delivery | `scv` CLI + localhost web UI (`scv serve`) |
| Static vs. LLM | Static analysis owns symbols and edges as ground truth. The Interpreter owns meaning: purpose, cross-file and cross-directory grouping, risk narration. Clustering/narration also draw on the repo's own docs (README, `docs/`) and directory structure, extracted once per run and folded in as advisory context — see [`analyze.md`](analyze.md#2-interpreter--llm) |
| LLM provider | Pluggable — Ollama (local, default) or Anthropic (cloud), same prompts and schema; see [`implement-analyze.md`](implement-analyze.md#stack) |
| Rendering | 2D first. 3D is a *skin* over the same layout engine, never a fork |
| Store | `.scv/` (gitignored), with a deterministic subset made checked-in-able later |
| Implementation | TypeScript end-to-end for v1 — see [`implement-analyze.md`](implement-analyze.md#stack) for why, and for the escape hatch |

**Not in v1:** runtime tracing, live profiling, hosted multi-tenant service. Cost and performance fields are static estimates plus Interpreter judgment, and are labeled low-confidence in the UI.

## Pipeline

```
repo ─▶ Extractor ─▶ SymbolGraph ─▶ Interpreter ─▶ UnitGraph ─▶ Differ ─▶ DeltaGraph
       (tree-sitter,  (facts only)    (LLM)         (snapshot)   (hashes)      │
        manifests,                                       │                     │
        git)                                             └────────┬────────────┘
                                                                  ▼
                                                        .scv/  ─▶  Server ─▶ Web UI
```

Three artifacts, three contracts:

1. **SymbolGraph** — deterministic, reproducible, no LLM. Cheap to recompute, cached by file blob hash.
2. **UnitGraph** (a *snapshot*) — SymbolGraph plus Interpreter semantics. This is the visualizer's contract.
3. **DeltaGraph** — the diff of two UnitGraphs, plus risk.

### On the name "Interpreter"

The pass that turns facts into meaning was called the *Lifter* in an earlier draft — compiler jargon for raising a low-level IR to a higher abstraction. Accurate, opaque. `src/utils/logging.py` in the `orderly` fixture already carries a `# interpreter note:` comment, so the vocabulary was there first. **Extractor → Interpreter → Differ** it is.

---

## Schema contract — `scv/1`

The UnitGraph schema is the **sole** contract between analyzer and visualizer. Both ship separately. Freeze it early; the visualizer builds against generated fixtures.

### Snapshot envelope

```jsonc
{
  "schema": "scv/1",
  "snapshot_id": "sha1(repo,rev)",
  "repo": { "root": "orderly", "vcs": "git" },
  "rev": { "sha": "bed04b3", "kind": "commit|pr|tag", "pr": 412,
           "ts": "…", "author": "j.moreau", "author_kind": "human|agent|baseline" },
  "provenance": { "extractor": "scv-ts/0.1.0",
                  "interpreter": { "provider": "anthropic|ollama", "model": "…", "prompt_rev": "p7" } },
  "units": [ Unit ], "edges": [ Edge ], "externals": [ External ]
}
```

### Unit

Every level is a Unit — system, layer, module, class, function, api_flow, block. One type, one renderer, recursive.

```jsonc
{
  "id": "u:py:src.api.middleware.rate_limiter.rate_limit.check#f",
  "kind": "system|layer|module|class|function|api_flow|block|unclustered",
  "name": "check",
  "qualname": "src.api.middleware.rate_limiter.rate_limit.check",
  "lang": "python",
  "parent": "u:…",                    // single tree; edges carry the DAG
  "children": ["u:…"],
  "loc": { "files": ["src/api/middleware/rate_limiter.py"],
           "start": 11, "end": 20, "sloc": 10 },
  "signature": { "in": [Port], "out": [Port], "raises": ["…"], "async": true },
  "semantics": {                      // Interpreter-authored, null until lifted
    "what": "…", "how": "…", "when": "…", "where": "…", "why": "…",
    "confidence": 0.86, "source": "llm"
  },
  "cost": { "complexity": 3, "io": ["redis"], "estimate": "2 Redis round-trips, blocking",
            "confidence": 0.82, "source": "static|llm|manual" },
  "tags": ["no-fallback", "hot-path"],
  "metrics": { "sloc": 10, "fan_in": 0, "fan_out": 1, "churn": 24, "commits": 1 },
  "authors": [{ "name": "orderly-agent", "lines": 24 }],
  "hash": { "struct": "…", "text": "…", "semantic": "…" },
  "provenance": { "source": "static|llm|manual", "pass": "B" }
}
```

`Port` = `{ name, type, nullable, description, source }`.

**`api_flow` units** additionally carry `route`, `steps` (the traced call chain, single
longest path — back-compat), and optional `stepsBranching` (a `{ unit, label?, children }`
tree preserving every branch instead of collapsing to one path, so e.g. a login handler's
success/failure split renders as two labeled children instead of picking one arbitrarily).
Framework-wired DI/middleware that runs before the handler but is never called from its body
(e.g. FastAPI `Depends()`) is spliced in as a linear prefix ahead of the handler in both
fields, resolved from `calls` edges tagged `via: "di"` on the underlying `SymbolGraph`.

**Three hashes drive everything downstream, cheaply:**

| hash | covers | a change means |
|---|---|---|
| `struct` | signature + outgoing edges | the interface moved |
| `text` | body, normalized (comments and whitespace stripped) | the implementation moved |
| `semantic` | the Interpreter's summary | the *meaning* moved |

`text` being normalized is what stops a reformat from reading as a change. `semantic` differing while `text` matches is what catches a rename that changed intent.

### Edge

```jsonc
{ "id": "e:…", "from": "u:…", "to": "u:…",
  "kind": "calls|imports|inherits|implements|reads|writes|emits|handles|configures|tests",
  "weight": 3,
  "evidence": [{ "file": "src/orders/repo.py", "line": 5 }],
  "source": "static|llm|manual", "confidence": 1.0, "rollup": false }
```

`depends_on` is outgoing, `users` is incoming. Stored once; the server indexes both directions.

### External

```jsonc
{ "id": "x:pypi:redis@5.0.1", "ecosystem": "pypi|npm|maven|go|cargo|service",
  "name": "redis", "version": "5.0.1", "direct": true, "depth": 1,
  "reached_by": ["u:py:src.api.middleware.rate_limiter#m"],
  "transitive_count": 2, "license": "MIT", "advisories": 0 }
```

`depth` and `transitive_count` drive the visual depth-of-dependency.

### Delta document — `scv-delta/1`

```jsonc
{
  "schema": "scv-delta/1",
  "from": { "snapshot_id": "…", "sha": "6ab4e5e" },
  "to":   { "snapshot_id": "…", "sha": "bed04b3" },
  "provenance": { …, "formulas": { … } },
  "inspect_queue": [                       // ranked; this is the product
    { "rank": 1, "unit": "u:…", "status": "added",
      "risk": 0.95, "confidence": 0.78, "ground_truth": "d1,d2" }
  ],
  "unit_deltas": [{
    "unit": "u:…", "qualname": "…", "kind": "module",
    "status": "added|removed|moved|renamed|modified|risk_changed|unchanged",
    "fields": ["hash.text", "hash.struct", "semantics"],
    "amount": 0.0-1.0,
    "blast_radius": { "direct": 2, "transitive": 9, "public_api": true },
    "authors": [{ "name": "…", "lines": 24 }],
    "risk": { "score": 0.95, "axes": { "functionality": .4, "availability": .95,
                                       "scalability": .5, "performance": .55, "security": .2 },
              "why": "…", "confidence": 0.78, "source": "llm|formula",
              "formula_floor": 0.71, "rank": 1, "ground_truth": "d2" }
  }],
  "edge_deltas": [{ "edge": "e:…", "from": "u:…", "to": "u:…",
                    "status": "added|removed|reweighted" }],
  "rollup": { "u:layer:edge": { "amount": 0.776, "risk": 0.95, "sloc": 67 } }
}
```

### Formulas (v1, tunable)

```
amount     = 0.4·text_diff + 0.3·struct_changed + 0.3·semantic_drift
risk_floor = amount · (0.5 + 0.5·norm(blast.transitive)) · boost(public_api, auth_boundary)
rollup.amount = sloc-weighted mean of children
rollup.risk   = max of children
```

The formula sets a floor so risk is never purely vibes; the Interpreter writes the axes and the `why`, and may raise the score above the floor but must justify it. Both numbers are kept in the document — `score` and `formula_floor` — so a reviewer can see where judgment departed from arithmetic.

**Rollup guarantees the outer view always shows where to drill.** A hot leaf is visible as a hot ancestor before you expand anything.

---

## Storage layout

```
.scv/                             # gitignored by default
  config.yaml
  cache/                          # blob-hash → extractor + interpreter results
  snapshots/<sha>.json
  deltas/<from>__<to>.json
  index.sqlite                    # rev timeline, unit→snapshot index, search
  layouts/<snapshot>.<skin>.json  # seeded positions, for stable replay
```

**Check-in split (later, opt-in).** `scv export --structural` writes only deterministic content — units, edges, externals, hashes, metrics — with **no** `semantics`, no `risk.why`, no LLM provenance. Structural data is reproducible from source, so an extractor upgrade regenerates it. Interpreter prose is never committed, precisely because it cannot be regenerated identically and a stale opinion is worse than no opinion. Committed files carry `extractor_version`; a mismatch triggers regeneration rather than trust.

---

## Reference fixture

`orderly` — a small FastAPI service with six real commits implementing task RL-114 (add rate limiting), authored partly by an agent and partly by a human, with hand-built ground-truth deltas in `task/RL-114.deltas.json`.

The pipeline runs end to end on it today — see [`mock/`](mock/README.md) for what
each piece is and how to regenerate.

```
snapshot 6ab4e5e   52 units   34 edges
snapshot 731c3e3   62 units   38 edges
…
snapshot bc3450f   72 units   40 edges
delta 6ab4e5e..bc3450f   38 unit deltas, 12 edge deltas, queue of 7
```

The ranked inspect queue reproduces all seven hand-built ground-truth deltas, in order. See [`analyze.md`](analyze.md#validation) for what that does and does not prove.

## Principal risks

| Risk | Mitigation |
|---|---|
| Interpreter clustering is unstable run to run | Deterministic checker plus cached decisions; recluster only when the import graph crosses a threshold; report a modularity score against the directory baseline |
| LLM cost on large repos and long replays | Content-addressed cache; commit-level snapshots structural-only; lift on demand |
| Cross-language edges (TS calling a Python service) | Explicit `api_flow` units matched by route string, marked `source:"llm"`, `confidence<1` |
| Layout churn breaks replay comprehension | Position seeding from the prior snapshot is a hard requirement, not polish |
| Risk scores read as authoritative | Every LLM field carries `confidence` and `source`; both `score` and `formula_floor` are kept; the UI renders low confidence differently |
| Committed structural data rots | `extractor_version` stamp; on mismatch, regenerate — never trust |

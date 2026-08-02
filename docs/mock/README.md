# doc/mock — working prototype

Not the product. A prototype that runs the whole `scv` pipeline end to end on one
fixture repo, so the schema in [`../design.md`](../design.md#schema-contract--scv1)
is validated by something that actually consumes it rather than by inspection.

Everything here is disposable once `packages/` exists. Keep it until then: it is
the only thing proving the contract holds.

## What is here

| | |
|---|---|
| `tools/extract.py` | **Extractor.** Real, deterministic, no LLM. Python-only (`ast`), standing in for the tree-sitter host. Resolves cross-module calls, computes normalized text hashes, reads churn and per-author lines from `git log --numstat`, derives externals from `requirements.txt` |
| `tools/interpret.json` | **Interpreter** output — clustering, semantics, `api_flow` traces, risk narration. Hand-authored; stands in for the LLM passes. Everything here lands in the snapshot as `source:"llm"` |
| `tools/build.py` | Merges the two, runs the **Differ**, writes `.scv/` |
| `tools/render.py` | Static export of the visualizer — reads `.scv/`, emits one self-contained HTML. `scv serve` with the fetches inlined |
| `tools/render_generic.py` | Same output as `render.py`, but for a real `packages/cli` `.scv/` store with arbitrary snapshot shas — discovers snapshots/deltas from the directory instead of `render.py`'s hardcoded `orderly` fixture `REV_ORDER`. Usage: `python3 tools/render_generic.py <.scv dir> <out.html>` |
| `.scv/` | Generated. 7 snapshots, 6 cumulative deltas, 5 step deltas |
| `scv-mock.html` | Generated. Open it directly, no server |

## Regenerate

Needs the `orderly` fixture repo — a small FastAPI service with six real commits
implementing task RL-114, authored partly by an agent and partly by a human, plus
hand-built ground-truth deltas in `task/RL-114.deltas.json`.

```sh
cd tools
python3 build.py  /path/to/orderly  ../.scv     # extract + interpret + diff
python3 render.py ../.scv ../scv-mock.html      # static export
```

Expected:

```
snapshot 6ab4e5e   52 units   34 edges
…
snapshot bc3450f   72 units   40 edges
delta 6ab4e5e..bc3450f  38 unit deltas, 12 edge deltas, queue of 7
+ 6 cumulative and 6 step deltas
```

Both generators are deterministic: re-running `render.py` on an unchanged `.scv/`
produces a byte-identical HTML file. If it does not, something is iterating a set
or a dict whose order is not pinned, and the diff will be noise forever after.

**The queue must be 7.** It reproduces all seven hand-built ground-truth deltas in
order. Treat it as a regression test: a formula or prompt change that drops it
below 7/7 is a regression, and the two it missed are more informative than the
five it kept. See [`../analyze.md`](../analyze.md#validation) for what that does
and does not prove.

## Testing the mock

There is no test runner. The layout engine and every view were verified headless
with jsdom — no rendering, no screenshots:

```sh
npm install jsdom
# then drive it: set S.mode / S.focus / S.rev, call render(), assert on the DOM
```

Worth reproducing if the layout engine is touched, because it is how these were
caught:

- **child rects escaping their parent tile** — the mini-map ran the layout engine
  directly at tile size, where the engine's absolute minimums (92px tiles, 18px
  gutters) exceeded the box, so rows centred to a negative x. Now it lays out at a
  nominal 560×340 and scales uniformly to fit, with a clip path as a backstop.
  Regression check: every child rect's x-range inside its parent polygon's, at
  several viewport widths — 430px wide is the case that broke.
- **crossing counts** — measured, not asserted. Numbers and the honest gap are in
  [`../implement-serve.md`](../implement-serve.md#v2-is-measured-not-asserted).

## Known to be prototype-grade

- `extract.py` is Python-only and `ast`-based. The real extractor is tree-sitter
  with a grammar registry.
- `interpret.json` is hand-authored. Milestone A6 is the same 7/7 with an LLM
  actually producing it from source.
- Externals stop at depth 1: `requirements.txt` has no lockfile, so transitive
  depth is genuinely uncomputable. The view says so rather than rendering an
  empty row.
- The visual pass is unfinished, by agreement. Functionality is close; it is not
  yet visually engaging.

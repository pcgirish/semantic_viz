# Mission

## What scv is for

`scv` exists to help developers understand a codebase — both what it is and
how it evolves — so they can make sense of their own changes to it. It
turns a repo into a `SymbolGraph` (units, edges, externals) via static
analysis, layers an LLM Interpreter and a Differ on top, then serves it as
a live, drillable tile map in the browser.

## The two questions it answers

- **What exists?** — the structure of a codebase at any point in its
  history, from the whole system down to a single function, with every
  level explained in the same vocabulary. This is **Current**: a map of the
  system as it stands, so a developer can orient in unfamiliar code, see
  what a module actually depends on, and read architecture instead of
  inferring it from file paths.
- **What changed, and what deserves a human?** — what moved between two
  revisions, who moved it, how much, and what it puts at risk. This is
  **Delta**: a raw text diff shows lines, not blast radius, cross-module
  exposure, or which of forty changed files actually matters. Delta turns
  "here's a diff" into "here's what to review first and why."

Neither view is the point without the other. Delta is meaningless without a
map of what was already there to compare against — Current supplies that
map. And a static map goes stale the moment code moves — Delta is what
keeps it honest across revisions and is what makes people open the tool on
a Tuesday, mid-review, before they approve a PR. The project treats both as
first-class: every pipeline stage (Extractor, Interpreter, Differ) and the
schema itself (`scv/1` snapshots, `scv-delta/1` deltas) are built to serve
both equally.

## Design philosophy

- **Static analysis owns facts, the LLM owns meaning.** Symbols and edges
  are ground truth from tree-sitter parsing — deterministic, reproducible,
  no LLM. The Interpreter owns purpose, cross-file/cross-directory
  grouping, and risk narration, drawing on the repo's own docs and
  directory structure as advisory context, never as ground truth.
- **One Unit type, one renderer, recursive.** System, layer, module, class,
  function, api_flow, block — all the same shape, all drillable the same
  way.
- **Rendering is a skin, not a fork.** 2D tiles first; 3D (`tiles3d`,
  `cityscape`) is a swappable skin over the same layout engine.
- **Confidence and provenance travel with every LLM-derived field.**
  Nothing the Interpreter writes is presented as fact without a
  `confidence`/`source` tag; risk scores keep both the formula floor and
  the judgment-adjusted score so a reviewer can see where they diverge.
- **Determinism where it's affordable.** Clustering, hashing, and layout
  are deterministic and cached; the LLM is invoked only where meaning
  genuinely requires judgment.

## Explicitly out of scope (v1)

Runtime tracing, live profiling, a hosted multi-tenant service. Cost and
performance fields are static estimates plus Interpreter judgment, labeled
low-confidence in the UI — not measured.

## Reference fixture

`fixtures/orderly` — a small FastAPI service with real commits implementing
a rate-limiting task, authored partly by a human and partly by an agent. It
validates both pillars: its snapshots exercise Current (units, edges,
clustering, narration on real code), and its hand-built ground-truth deltas
validate Delta — the inspect queue's coverage against them is the project's
running correctness check (see `docs/analyze.md#validation`), proof the
ranked queue surfaces what a human reviewer would actually flag.

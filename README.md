# scv — semantic code visualizer

A multi-view visualizer for software projects. It turns a repo into a
`SymbolGraph` (units, edges, externals) via static analysis, then — in later
stages of this project — layers an LLM Interpreter, a Differ, and a web UI on
top.

See [`docs/design.md`](docs/design.md) for the full architecture, schema
contract, and pipeline. See [`docs/implement-analyze.md`](docs/implement-analyze.md)
and [`docs/implement-serve.md`](docs/implement-serve.md) for milestones.

## Status

This repo is under active build-out; not all pipeline stages exist yet.

| Package | What it does | Status |
|---|---|---|
| `packages/extractor` | Parses a repo (Python + TypeScript via tree-sitter), resolves imports/calls into units and edges, reads `requirements.txt`/`package.json` manifests, and pulls per-file churn/authors from `git log` | Implemented |
| `packages/schema` | Zod schemas (+ generated JSON Schema) for the `SymbolGraph`/`UnitGraph` contract | Implemented |
| Interpreter, Differ, CLI, Server/Web UI | LLM semantics pass, snapshot diffing, `scv` CLI, `scv serve` web UI | Not yet built |

A disposable Python prototype of the *full* pipeline (extract → interpret →
diff → render) lives at [`docs/mock/`](docs/mock/README.md) and is useful for
seeing the end-to-end shape of the product before the TypeScript packages
catch up.

## Requirements

- Node.js ≥ 24
- npm

## Setup

```sh
npm install
```

## Commands

```sh
npm test        # run all tests (vitest)
npm run lint    # lint all packages (eslint)
npm run dev     # run the CLI package in dev mode (once packages/cli exists)
```

Run a single package's tests/build directly if you only touched one:

```sh
npm test --workspace packages/extractor
npm run build --workspace packages/extractor
```

## Using the extractor

The only consumable API today is `extractRepo`, which walks a repo on disk
and returns a `SymbolGraph`:

```ts
import { extractRepo } from "@scv/extractor";

const graph = extractRepo("/path/to/repo");

graph.units;     // modules, classes, functions — each with metrics, authors, hash
graph.edges;     // imports/calls between units
graph.externals; // third-party deps, with ecosystem, version, direct, depth, reached_by
```

Notes on what it does under the hood:

- **Languages:** Python and TypeScript, via tree-sitter grammars in `packages/extractor/src/grammars`.
- **Manifests:** reads `requirements.txt` (pypi) or `package.json` (npm) at the repo root to resolve pinned versions for externals.
- **VCS:** shells out to `git log --numstat` to compute per-file churn, commit counts, and per-author line contributions; returns empty data for non-git directories.
- **Determinism:** the same repo state always produces the same unit hashes — no LLM involved at this stage.

## Repo layout

```
packages/
  extractor/   # tree-sitter-based static analysis -> SymbolGraph
  schema/      # shared Zod/JSON schemas for the pipeline contract
docs/          # design docs, milestone plans, and the disposable Python mock
fixtures/      # sample repos used by tests (gitignored except small TS fixtures)
```

## Contributing

See [`CLAUDE.md`](CLAUDE.md) for coding rules, TDD workflow, and the git
branch → PR → merge flow used in this repo.

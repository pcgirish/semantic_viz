# scv — semantic code visualizer

A multi-view visualizer for software projects. It turns a repo into a
`SymbolGraph` (units, edges, externals) via static analysis, then — in later
stages of this project — layers an LLM Interpreter, a Differ, and a web UI on
top.

See [`docs/design.md`](docs/design.md) for the full architecture, schema
contract, and pipeline. See [`docs/implement-analyze.md`](docs/implement-analyze.md)
and [`docs/implement-serve.md`](docs/implement-serve.md) for milestones.

## Status

Static-analysis-only pipeline is complete end to end: you can point `scv` at
a real repo, extract it, serve it, and browse it as a live tile map in the
browser today. The Interpreter's leaf-semantics pass (A4) is implemented but
not yet wired into `scv analyze`; clustering/architecture narration (A5/A6)
and the Differ are not built yet — semantics/cost fields render as explicit
"not yet available" states in the UI until that wiring lands.

| Package | What it does | Status |
|---|---|---|
| `packages/extractor` | Parses a repo (Python + TypeScript via tree-sitter), resolves imports/calls into units and edges, reads `requirements.txt`/`package.json` manifests, and pulls per-file churn/authors from `git log` | Implemented |
| `packages/schema` | Zod schemas (+ generated JSON Schema) for the `SymbolGraph`/`UnitGraph` contract | Implemented |
| `packages/cli` | `scv analyze` — extracts a repo and writes a `scv/1` snapshot to `.scv/snapshots/` | Implemented |
| `packages/server` | Fastify API serving snapshots (`/api/revs`, `/api/snapshot/:sha`, `/api/search`, ...) | Implemented |
| `packages/layout` | Pure Sugiyama-style layered layout engine (rank → order → place → route), dummy-node expansion, port spreading, recursive mini-maps | Implemented |
| `packages/skins/tiles` | SVG rendering skin: chamfered tiles, complexity glyphs, dependency-highlight links | Implemented |
| `packages/ui` | React app: canvas (select/drill/ascend, hover-highlight) + inspector tray | Implemented |
| `packages/interpreter` | Pass A (leaf semantics via `Provider`: `ollama`, `anthropic`, `claude-cli`) + content cache | A4 implemented, not wired into `scv analyze` |
| Interpreter Pass B/C/D, Differ | Clustering, architecture narration, risk narration, snapshot diffing (delta/replay mode) | Not yet built (A5/A6) |

A disposable Python prototype of the *full* pipeline (extract → interpret →
diff → render) lives at [`docs/mock/`](docs/mock/README.md) and is useful for
seeing the end-to-end shape of the product before the LLM stages catch up.

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

## Seeing a codebase

End to end, static analysis only (no LLM involved):

```sh
# 1. extract a repo and write a snapshot
npm run build --workspace packages/cli
node packages/cli/dist/bin.js analyze /path/to/repo

# 2. serve it over HTTP
npm run build --workspace packages/server
node packages/server/dist/bin.js /path/to/repo

# 3. run the UI (proxies /api to the server above)
npm run dev --workspace packages/ui
```

Open the UI dev server URL in a browser. You get a layered tile map of the
repo's units (modules/classes/functions), each tile labeled with its name and
sloc/fan-in/fan-out, sized by SLOC and shaped by complexity. Scroll to zoom
(anchored at the cursor) and drag to pan — real repos lay out wide and flat,
so zoom is how you read it. Click a tile to select it and open the inspector
tray; double-click to drill into it (double-click empty canvas to ascend back
out); hover to highlight what it depends on vs. what depends on it.

`semantics` (what/how/when/where/why) and `cost.estimate` show as "not yet
available — no Interpreter pass has run" until `packages/interpreter` exists.
Everything else — structure, metrics, fan-in/out, dependency edges — is real,
extracted static analysis.

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
  extractor/     # tree-sitter-based static analysis -> SymbolGraph
  interpreter/   # Pass A (leaf semantics), Provider interface, content cache
  schema/        # shared Zod/JSON schemas for the pipeline contract
  cli/           # `scv analyze` — writes scv/1 snapshots
  server/        # Fastify API serving snapshots
  layout/        # pure layered layout engine (rank/order/place/route)
  skins/tiles/   # SVG rendering skin
  ui/            # React app: canvas + inspector tray
docs/            # design docs, milestone plans, and the disposable Python mock
fixtures/        # sample repos used by tests (gitignored except small TS fixtures)
```

## Contributing

See [`CLAUDE.md`](CLAUDE.md) for coding rules, TDD workflow, and the git
branch → PR → merge flow used in this repo.

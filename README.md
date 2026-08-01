# scv — semantic code visualizer

A multi-view visualizer for software projects. It turns a repo into a
`SymbolGraph` (units, edges, externals) via static analysis, then — in later
stages of this project — layers an LLM Interpreter, a Differ, and a web UI on
top.

See [`docs/design.md`](docs/design.md) for the full architecture, schema
contract, and pipeline. See [`docs/implement-analyze.md`](docs/implement-analyze.md)
and [`docs/implement-serve.md`](docs/implement-serve.md) for milestones.

## Status

The full pipeline — Extractor → Interpreter (Pass A–D) → Differ — is
implemented end to end and wired into the CLI: `scv analyze` extracts a repo
and lifts semantics, clustering, and layer narration in one pass; `scv diff`
diffs two snapshots with LLM risk narration and produces a ranked inspect
queue. You can point `scv` at a real repo, extract it, serve it, and browse
it as a live tile map in the browser today.

**A6 validation against `fixtures/orderly`** (`docs/analyze.md`'s exit
criterion): the inspect queue correctly surfaces all 7/7 module-level
ground-truth entities (`fixtures/orderly/task/RL-114.deltas.json`) with a
local LLM in the loop — coverage is exact. Rank *order* does not yet match
the ground truth's order; ranking is the Interpreter's judgment call and its
quality depends on the underlying model, which a stronger model should
improve without any code change. `risk_changed` (flagging a unit whose own
diff is empty but whose dependency changed) is not yet implemented — the one
ground-truth entry that requires it (`tests.integration.test_orders`) is
absent from the queue.

| Package | What it does | Status |
|---|---|---|
| `packages/extractor` | Parses a repo (Python + TypeScript via tree-sitter), resolves imports/calls into units and edges, reads `requirements.txt`/`package.json` manifests, and pulls per-file churn/authors from `git log` | Implemented |
| `packages/schema` | Zod schemas (+ generated JSON Schema) for the `SymbolGraph`/`UnitGraph` contract | Implemented |
| `packages/interpreter` | Pass A (leaf semantics), Pass B (import-cohesion clustering + deterministic checker), Pass C (architecture narration), Pass D (five-axis risk narration) + inspect-queue ranking, all via `Provider` (`ollama`, `anthropic`, `claude-cli`) + content cache | Implemented |
| `packages/differ` | Matches units across snapshots, classifies changes from hashes, computes blast radius and formula-floor risk, rolls amount/risk up to every ancestor; overrides risk with Pass D + ranking | Implemented |
| `packages/cli` | `scv analyze` — extracts + lifts a repo into a `scv/1` snapshot; `scv diff <from> <to>` — diffs two snapshots into a `scv-delta/1` file with a ranked inspect queue | Implemented |
| `packages/server` | Fastify API serving snapshots (`/api/revs`, `/api/snapshot/:sha`, `/api/search`, ...) | Implemented |
| `packages/layout` | Pure Sugiyama-style layered layout engine (rank → order → place → route), dummy-node expansion, port spreading, recursive mini-maps | Implemented |
| `packages/skins/tiles` | SVG rendering skin: chamfered tiles, complexity glyphs, dependency-highlight links | Implemented |
| `packages/ui` | React app: canvas (select/drill/ascend, hover-highlight) + inspector tray | Implemented |

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

## Configuring the LLM provider

`scv analyze` (Pass A/B/C) and `scv diff` (Pass D + ranking) both call an LLM
provider, resolved from `<scvDir>/config.yaml` (default `.scv/config.yaml`).
No file → defaults to `ollama`.

On the very first run there's no `.scv/` yet, so there's nothing to hand-edit.
Pass `--provider`/`--model`/`--effort` to `analyze` instead — they're written
to `config.yaml` (creating `.scv/` if needed) before the run, so later
invocations reuse them without flags:

```sh
node packages/cli/dist/bin.js analyze /path/to/repo \
  --provider anthropic --model claude-sonnet-5
```

Or write `config.yaml` directly, any time:

```yaml
interpreter:
  provider: ollama       # ollama | anthropic | claude-cli
  model: qwen3.6:0.8b-mlx  # optional; each provider has its own default
  effort: low             # claude-cli only: low | medium | high | xhigh | max
```

- `ollama` — local, default model `qwen3.6:0.8b-mlx`. Requires a running
  Ollama daemon.
- `anthropic` — Anthropic API, default model `claude-sonnet-5`. Requires
  `ANTHROPIC_API_KEY` in the environment (never in `.scv/config.yaml`).
- `claude-cli` — shells out to the local `claude` CLI. Not used by default in
  this repo's own dev/test loop — see `packages/interpreter/src/providers/`
  for provider implementations.

Interpreter calls are content-cached at `<scvDir>/cache.sqlite`, so
re-running against an unchanged unit never re-invokes the provider.

## Seeing a codebase

End to end, including the Interpreter (needs a provider — `ollama` by default,
configured via `.scv/config.yaml`, see above):

```sh
# 1. extract a repo, lift semantics/clustering, and write a snapshot
npm run build --workspace packages/cli
node packages/cli/dist/bin.js analyze /path/to/repo

# 2. (optional) diff two snapshots once you have two revs analyzed
node packages/cli/dist/bin.js diff <from-sha> <to-sha> --scv-dir /path/to/repo/.scv

# 3. serve it over HTTP
npm run build --workspace packages/server
node packages/server/dist/bin.js /path/to/repo

# 4. run the UI (proxies /api to the server above)
npm run dev --workspace packages/ui
```

Open the UI dev server URL in a browser. You get a layered tile map of the
repo's units (modules/classes/functions), each tile labeled with its name and
sloc/fan-in/fan-out, sized by SLOC and shaped by complexity. Scroll to zoom
(anchored at the cursor) and drag to pan — real repos lay out wide and flat,
so zoom is how you read it. Click a tile to select it and open the inspector
tray; double-click to drill into it (double-click empty canvas to ascend back
out); hover to highlight what it depends on vs. what depends on it.

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
  interpreter/   # Pass A-D, Provider interface, content cache, checker, ranking
  differ/        # match, classify, blast radius, rollup
  schema/        # shared Zod/JSON schemas for the pipeline contract
  cli/           # `scv analyze` / `scv diff`
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

# scv — semantic code visualizer

A multi-view visualizer for software projects. It turns a repo into a
`SymbolGraph` (units, edges, externals) via static analysis, layers an LLM
Interpreter and a Differ on top, then serves it as a live, drillable tile map
in the browser.

See [`docs/design.md`](docs/design.md) for the full architecture, schema
contract, and pipeline. See [`docs/implement-analyze.md`](docs/implement-analyze.md)
and [`docs/implement-serve.md`](docs/implement-serve.md) for milestones.

## Status

The full pipeline — Extractor → Interpreter (Pass A–D) → Differ — is
implemented end to end and wired into the CLI, server, and UI: `scv analyze`
extracts a repo and lifts semantics, clustering, and layer narration in one
pass; `scv diff` diffs two snapshots with LLM risk narration and produces a
ranked inspect queue. Point `scv` at a real repo, extract it, serve it, and
browse it as a live tile map today.

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
| `packages/interpreter` | Pass A (leaf semantics), Pass B (import-cohesion clustering + deterministic checker), Pass C (architecture narration + branch-preserving API flow tracing, including framework DI/middleware steps), Pass D (five-axis risk narration) + inspect-queue ranking, all via `Provider` (`ollama`, `anthropic`, `claude-cli`) + content cache | Implemented |
| `packages/differ` | Matches units across snapshots, classifies changes from hashes, computes blast radius and formula-floor risk, rolls amount/risk up to every ancestor; overrides risk with Pass D + ranking | Implemented |
| `packages/cli` | `scv analyze` — extracts + lifts a repo into a `scv/1` snapshot; `scv diff <from> <to>` — diffs two snapshots into a `scv-delta/1` file with a ranked inspect queue | Implemented |
| `packages/server` | Fastify API serving snapshots (`/api/revs`, `/api/snapshot/:sha`, `/api/search`, `/api/delta/:from/:to`, ...) | Implemented |
| `packages/layout` | Pure Sugiyama-style layered layout engine (rank → order → place → route), dummy-node expansion, port spreading, recursive mini-maps | Implemented |
| `packages/skins/tiles` | SVG rendering skin: chamfered tiles colored by semantic layer, complexity glyphs + numeric labels, dependency-highlight links. Wired into `packages/ui` today | Implemented |
| `packages/skins/tiles3d` | three.js rendering skin: same scene extruded to prisms/cylinders (sides = complexity, height = sloc), orbit camera, risk beacons above the roofline, density-gated links; zero changes under `packages/layout`. Not yet wired into `packages/ui` (`tilesSkin` is still hardcoded there) | Implemented |
| `packages/ui` | React app: canvas (select/drill/ascend, hover-highlight) + inspector tray + Delta view (rev picker, status/amount/risk tile coloring, rollup fallback for collapsed ancestors, left-margin inspect queue) + Replay timeline (rev scrub, PR/commit density toggle, per-rev amount bars, human/agent distinction) + Depends-on view + Flows view + Flowchart view, fully migrated onto `packages/design-system` (the CodeDream design system) — no bespoke `app.css` remains | Implemented |
| `packages/design-system` | CodeDream design tokens (color, type, spacing, radius) + shared components (`Toolbar`, `SegmentedControl`, `Select`, `Tray`, `Card`, `Badge`, `BubbleChart`, ...) consumed by `packages/ui` | Implemented |

A disposable Python prototype of the *full* pipeline (extract → interpret →
diff → render) lives at [`docs/mock/`](docs/mock/README.md) and is useful for
seeing the end-to-end shape of the product before the LLM stages catch up.

## Requirements

- Node.js ≥ 24
- npm
- For the default LLM provider (`ollama`): a running local Ollama daemon

## Setup

```sh
npm install
```

This is a single npm workspace (`packages/*` + `packages/skins/*`) — one
install resolves and links every package.

## Build everything

```sh
npm run build
```

This runs `tsc -b` at the repo root, which builds **every package in
dependency order** in one pass (schema → extractor/layout → interpreter/
differ → cli/server/skins → ui) — you never need to build packages one at a
time. Re-running it is incremental: only packages whose inputs changed
rebuild.

To force a full rebuild from clean:

```sh
npx tsc -b --clean   # drop all build state
npm run build        # rebuild everything from scratch
```

## Commands

```sh
npm run build   # build every package, in dependency order, in one go
npm test        # run every package's tests (vitest)
npm run lint    # lint the whole repo (eslint)
npm run dev     # run the CLI package in dev mode (tsx, no build needed)
```

Scope any of these to a single package with `--workspace` if you only touched
one and want a faster loop:

```sh
npm test --workspace packages/extractor
npm run build --workspace packages/extractor
```

## Seeing a codebase end to end

Needs a provider for the Interpreter steps — `ollama` by default, see
[Configuring the LLM provider](#configuring-the-llm-provider) below.

```sh
# 0. build everything once
npm run build

# 1. extract a repo, lift semantics/clustering, and write a snapshot
node packages/cli/dist/bin.js analyze /path/to/repo

# 2. (optional) diff two revs once you have two snapshots analyzed
node packages/cli/dist/bin.js diff <from-sha> <to-sha> --scv-dir /path/to/repo/.scv

# 3. serve it over HTTP (defaults: repo = cwd, port 3000; override with PORT=... )
node packages/server/dist/bin.js /path/to/repo

# 4. run the UI dev server (proxies /api to the server started in step 3)
npm run dev --workspace packages/ui
```

Open the UI dev server URL in a browser. You get a layered tile map of the
repo's units (modules/classes/functions), each tile labeled with its name and
sloc/fan-in/fan-out, sized by SLOC and shaped by complexity, and colored by
the semantic layer the Interpreter clustered it into (a legend in the
bottom-left corner lists each layer present in the current view). Scroll to
zoom (anchored at the cursor) and drag to pan — real repos lay out wide and
flat, so zoom is how you read it. Click a tile to select it and open the
inspector tray; double-click to drill into it (double-click empty canvas to
ascend back out); hover to highlight what it depends on vs. what depends on
it.

The top bar switches between four views:

- **Current** — the live tile map described above.
- **Delta** — diffs two revisions: tiles are colored by change status
  (added/removed/modified), an offset ring flags high risk, and a left-margin
  inspect queue ranks the units most worth reviewing first.
- **Depends on** — lists third-party externals (with ecosystem, version,
  direct/transitive depth) reached from the current selection.
- **Flows** — traces a single `api_flow` end to end (the units one request
  actually touches, including every branch — e.g. success/failure — and any
  framework-wired DI/middleware ahead of the handler), with a step dot per
  changed unit in Delta mode.

A Replay timeline along the bottom scrubs through revisions (rev picker or
drag), toggles between PR- and commit-level density, and shows a per-rev
amount bar with human/agent authorship distinguished.

## Screenshots

The UI runs on the CodeDream design system (`packages/design-system`), in
both a dark and a light skin.

| Current | Delta |
|---|---|
| ![Current mode, dark skin](docs/screenshots/current-dark.png) | ![Delta mode, dark skin](docs/screenshots/delta-dark.png) |

| Depends on | Flows |
|---|---|
| ![Depends-on mode, dark skin](docs/screenshots/depends-dark.png) | ![Flows mode, dark skin](docs/screenshots/flows-dark.png) |

| Flowchart (dark) | Current (light) |
|---|---|
| ![Flowchart mode, dark skin](docs/screenshots/flowchart-dark.png) | ![Current mode, light skin](docs/screenshots/current-light.png) |

Known issue: the light skin's canvas background vignette is a known defect
(`GraphCanvas`'s radial-gradient background is hardcoded for the dark skin) —
tracked as a followup, not part of the design-system migration.

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
  Ollama daemon with that model pulled (`ollama list` to check; `--model`
  to point at whatever you actually have installed).
- `anthropic` — Anthropic API, default model `claude-sonnet-5`. Requires
  `ANTHROPIC_API_KEY` in the environment (never in `.scv/config.yaml`).
- `claude-cli` — shells out to the local `claude` CLI. Not used by default in
  this repo's own dev/test loop — see `packages/interpreter/src/providers/`
  for provider implementations.

Interpreter calls are content-cached at `<scvDir>/cache.sqlite`, so
re-running against an unchanged unit never re-invokes the provider.

Pass A fires one provider call per leaf unit (function/class), all in
parallel — fine for a small repo or fixture, but a large repo (hundreds of
units) against a local `ollama` daemon can open more concurrent connections
than it handles gracefully, surfacing as `fetch failed` in the analyze
output. If you hit that, analyze a smaller subtree first, or use a hosted
provider (`anthropic`) for the full run.

## Using the extractor as a library

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
  skins/
    tiles/       # SVG rendering skin (wired into packages/ui)
    tiles3d/     # three.js rendering skin (not yet wired into packages/ui)
  ui/            # React app: canvas + inspector tray + Delta/Replay/Depends-on/Flows views
docs/            # design docs, milestone plans, and the disposable Python mock
fixtures/        # sample repos used by tests (gitignored except small TS fixtures)
```

## Contributing

See [`CLAUDE.md`](CLAUDE.md) for coding rules, TDD workflow, and the git
branch → PR → merge flow used in this repo.

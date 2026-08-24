# Tech Stack

## Language & runtime

- TypeScript end-to-end (v1), Node.js ≥ 24
- npm workspaces monorepo: `packages/*` + `packages/skins/*`, one install
  resolves and links every package
- `tsc -b` builds all packages in dependency order in one pass; incremental
  by default

## Core libraries

| Concern | Library |
|---|---|
| Parsing | tree-sitter (`tree-sitter`, `tree-sitter-python`, `tree-sitter-typescript`, `tree-sitter-javascript`) |
| Schema/validation | Zod (`zod`) — sole source of input validation per project rules |
| HTTP server | Fastify (`fastify`) |
| Embedded DB | `better-sqlite3` — Interpreter content cache, index |
| UI framework | React (`react` ^18) |
| 3D rendering | three.js (`three`) |
| Testing | Vitest (`vitest`) |
| Linting | ESLint + typescript-eslint (`eslint`, `typescript-eslint`) |

## Pipeline architecture

```
repo ─▶ Extractor ─▶ SymbolGraph ─▶ Interpreter ─▶ UnitGraph ─▶ Differ ─▶ DeltaGraph
       (tree-sitter,  (facts only)    (LLM)         (snapshot)   (hashes)
        manifests, git)
```

Two schema-versioned contracts, both first-class: `scv/1` (the
snapshot/UnitGraph — backs the Current view) and `scv-delta/1` (the
DeltaGraph — backs the Delta view). Schema is the sole contract between
analyzer and visualizer; each side ships and tests independently against
it.

## LLM provider layer

Pluggable, same prompts/schema across providers, configured via
`.scv/config.yaml`:

- `ollama` — local, default (`qwen3.5:9b-mlx`)
- `anthropic` — cloud, default `claude-sonnet-5`, requires
  `ANTHROPIC_API_KEY` in environment (never committed)
- `claude-cli` — shells out to local `claude` CLI (fixtures/manual use only,
  per project convention — not used in default dev/test loop)

Interpreter calls are content-cached (`<scvDir>/cache.sqlite`) keyed by
blob/unit hash, so unchanged units never re-invoke the provider.

## Package layout

```
packages/
  schema/          # Zod/JSON schemas — the pipeline contract
  extractor/       # tree-sitter static analysis -> SymbolGraph
  interpreter/     # Pass A/Docs/B/C/D, Provider interface, cache, ranking
  differ/          # match, classify, blast radius, rollup
  layout/          # pure layered layout engine (rank/order/place/route)
  skin-contract/   # Skin<TNode,TLink,TRegion> contract, camera/navigate model
  skins/
    tiles/         # SVG rendering skin
    tiles3d/       # three.js skin, orbit camera
    cityscape/     # three.js skin, walk/fly camera + minimap
  cli/             # `scv analyze` / `scv diff` / `scv serve` / `scv ui`
  server/          # Fastify API serving snapshots
  ui/              # React app: canvas + inspector + Delta/Replay/Depends-on/API Flow/Flowchart
  design-system/   # CodeDream design tokens + shared components
```

## Storage

```
.scv/                             # gitignored by default
  config.yaml
  cache/                          # blob-hash -> extractor + interpreter results
  cache.sqlite                    # interpreter content cache
  snapshots/<sha>.json
  deltas/<from>__<to>.json
  index.sqlite                    # rev timeline, unit->snapshot index, search
  artifacts/<sha>/                # per-stage cached interpreter artifacts
  layouts/<snapshot>.<skin>.json  # seeded positions, for stable replay
```

A later opt-in `scv export --structural` writes only deterministic content
(no LLM-authored fields) for check-in.

## Commands

```sh
npm run build   # tsc -b at root, dependency order, incremental
npm test        # vitest run, all packages
npm run lint    # eslint .
npm run dev     # tsx, packages/cli, no build needed
```

Scope to one package with `--workspace packages/<name>` for a faster loop.

## Conventions enforced project-wide

- TDD RED-GREEN-Refactor — no implementation before a failing test
- Input validation via Zod only — never trust raw request data
- No secrets in code/comments; `.env` never read/written directly, use
  `.env.example` for shape
- Never run `claude-cli` by default in dev/test — `ollama` is the default
  provider for this repo's own loop

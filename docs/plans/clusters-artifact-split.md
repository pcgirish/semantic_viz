# Split `layers` into a free `clusters` artifact + a narration-only `layers` artifact

## Context

`scv analyze <root> layers` currently computes both Pass B (file clustering,
deterministic, free) and Pass C (layer narration, real LLM call) as one
atomic artifact — `runLayersPass` (`packages/interpreter/src/orchestrate.ts:457-561`)
calls `runPassB` at line 510, then unconditionally calls `runPassC` at line
521. There's no way to stop after clustering.

This bit a real dogfooding run: to preview which files Pass B would group
together (needed to hand-write matching layer narration for
`agent-narrate-layers`), the only entry point was `scv analyze <root> layers`,
which also silently triggered a real narration call against whatever
provider `.scv/config.yaml` names (defaulting to `ollama`) — unwanted cost
and surprise.

`scv analyze [root] [artifact]` already separates work at the artifact
level (`ARTIFACT_DEPENDENCIES`, `packages/cli/src/artifacts.ts:33-40`) —
requesting one artifact computes only its declared deps, no more. The fix
is to apply that same separation one level deeper: promote Pass B's output
to its own cacheable artifact (`clusters`), and make `layers` depend on it
instead of computing it inline. Then `scv analyze <root> clusters` is a
free preview, and `agent-narrate-layers` can read real cluster `files` sets
without triggering narration.

## Split point (confirmed by reading `orchestrate.ts:457-561`)

Clean boundary at line 513, between Pass B and Pass C:
- **Before (460-512, clustering half):** builds `unitsByFile`, `files`,
  `importEdges`, `repoContextText` (built here but only consumed by Pass C
  — moves down), calls `runPassB`. No `provider`, no `previousLayers`.
- **After (513-560, narration half):** builds `parentOverride` from
  `passB.groups`, calls `runPassC`, resolves names
  (`resolveLayerNames`/`previousLayers`), builds `layerUnits`/`layers`/`layerIdByName`.

`parentOverride` is derived purely from `passB.groups` (module id → layer
id), so it can be rebuilt in the narration half from the clusters artifact
— no need to persist it twice.

## New artifact: `clusters`

`packages/cli/src/artifacts.ts`:
- Add `"clusters"` to `ArtifactName`.
- `ARTIFACT_DEPENDENCIES.clusters = ["functions", "docs"]` (same deps
  `layers` has today); `ARTIFACT_DEPENDENCIES.layers = ["clusters"]`
  (drops `functions`/`docs` — reached transitively).
- `ClustersData` interface: `{ groups: ClusterGroups (passB.groups as entries), unitsByFile: [string, string[]][], repoContextText: string | undefined, modularity: number, directoryModularity: number, clusteringVersion: string }`.
- `computeInputHash("clusters", ...)`: same formula as today's `layers` case
  minus `ctx.promptRev` (clustering doesn't consume the prompt) —
  `hashOf(functions.units.map(...).join("\n"), edges.join("\n"), JSON.stringify(docs), CLUSTERING_VERSION, ARTIFACT_SCHEMA_VERSION)`.
- `computeInputHash("layers", ...)`: now derived from `deps.clusters` plus
  `ctx.promptRev` — `hashOf(clusters-derived content, ctx.promptRev, ARTIFACT_SCHEMA_VERSION)`.
  Bump `ARTIFACT_SCHEMA_VERSION` to `"4"` (new artifact shape).
- `computeArtifact("clusters", ...)`: new case, runs `runClustersPass` (see
  below), returns `ClustersData`.
- `computeArtifact("layers", ...)`: now takes `deps.clusters` instead of
  computing clustering inline; calls `runNarrationPass` (see below).
- `LayersData` drops `parentOverride`-as-source-of-truth duplication? No —
  keep `parentOverride`/`repoContextText` in `LayersData` too (rebuilt from
  `clusters` deps in `computeArtifact`), since `groups`'s `computeArtifact`
  currently reads them off `layers` (`artifacts.ts:222,225`) — avoid
  touching the `groups` case at all by keeping `LayersData`'s shape
  unchanged, just sourced differently internally.

## `orchestrate.ts` split

Replace `runLayersPass` with two exported functions:

```ts
export interface RunClustersPassOptions {
  snapshot: Snapshot;
  units: Unit[];
  docExtracts: DocExtract[];
  reportProgress: ReportProgress;
}
export interface RunClustersPassResult {
  groups: ClusterGroups;
  unitsByFile: Map<string, Unit[]>;
  repoContextText: string | undefined;
  modularity: number;
  directoryModularity: number;
}
export function runClustersPass(options: RunClustersPassOptions): RunClustersPassResult
```
Body = current lines 460-512 (minus the `reportProgress("pass B"...)` calls,
kept), no `async` needed (no `await` inside — `runPassB` is sync).

```ts
export interface RunNarrationPassOptions {
  clusters: RunClustersPassResult;
  units: Unit[]; // for oneLiners
  provider: Provider;
  promptRev: string;
  reportProgress: ReportProgress;
  previousLayers?: Map<string, Layer>;
}
export interface RunNarrationPassResult {
  layerUnits: Unit[];
  layers: Layer[];
  parentOverride: Map<string, string>;
  layerIdByName: Map<string, string>;
}
export async function runNarrationPass(options: RunNarrationPassOptions): Promise<RunNarrationPassResult>
```
Body = current lines 482-486 (`oneLiners`, needs `units` — leaf-kind scan,
independent of clustering, can live in either half; keep in narration half
since it's only consumed by Pass C) + 513-560, reading `passB.groups` as
`options.clusters.groups`.

Keep `runLayersPass` as a thin wrapper (`runClustersPass` then
`runNarrationPass`) for any direct callers outside the artifact system
(check test files) — or remove if only `artifacts.ts` calls it (verify via
grep before deciding).

## CLI surface

`packages/cli/src/bin.ts`: `analyze`'s `[artifact]` argument description
gains `clusters` to the list: `functions | docs | clusters | layers | groups | flows`.
No new flag — `scv analyze <root> clusters` is the free-preview entry point,
consistent with how `functions`/`docs` already work. `--no-llm` continues
to skip everything as today (clusters would also be skipped, since
`--no-llm` bypasses the whole `ensureArtifact` chain) — that's fine, the
new value proposition is `scv analyze <root> clusters` *without* `--no-llm`,
which now does real free clustering without narration.

## `merge-semantics.ts` (`mergeLayerClustering`)

Currently calls `runPassB` directly (`merge-semantics.ts:306`) to get real
clusters for matching pending narration. Leave this as-is — it already
gets the free-clustering behavior this whole change is about, just via a
different code path. No change required here, but update
`agent-narrate-layers/SKILL.md` step 1 (see below) to point at the new
`scv analyze <root> clusters` command as the preview method, replacing the
current "just proceed with your own understanding" workaround text.

## Skill doc update

`.agents/skills/agent-narrate-layers/SKILL.md` step 1 currently says:
> If you want to see the real clustering first, run `scv analyze <root> layers --no-llm` is not sufficient... instead just proceed to step 2 with your own understanding

Replace with: run `scv analyze <root> clusters` (free, no LLM call) and
read `.scv/artifacts/<sha>/clusters.json` for real `files` sets per group,
before writing narration.

## Verification

TDD per project convention:
1. `packages/cli/test/artifacts.test.ts` (or wherever `ensureArtifact`
   is tested) — new/updated tests, written first (failing):
   - `ensureArtifact("clusters", ctx)` computes without a `Provider` call
     (assert on a spy/counting provider that Pass C — i.e. provider.interpret
     — is never invoked).
   - `ensureArtifact("layers", ctx)` still narrates correctly and produces
     the same `LayersData` shape/content as before the split (regression:
     compare against current behavior on `fixtures/orderly`).
   - Cache reuse: `clusters.json`'s `inputHash` doesn't change when only
     `promptRev` changes; `layers.json`'s does.
   - `scv analyze <root> clusters` CLI-level test: exits 0, writes
     `clusters.json`, does not write/touch `layers.json`.
2. Implement `runClustersPass`/`runNarrationPass` split, `artifacts.ts`
   changes, `bin.ts` doc-string update, until green.
3. `npm test` and `npm run lint` at repo root.
4. Manual check against `fixtures/orderly` (or the real
   `../eq_to_word_problem` dogfood repo): run `scv analyze <root> clusters`,
   confirm no ollama call happens (check process output / no
   `cache.sqlite` provider-call row for that sha), inspect
   `.scv/artifacts/<sha>/clusters.json` for real file groups; then run
   `scv analyze <root> layers` and confirm narration still works and
   `groups`/`flows` still build correctly on top.

## Git workflow

Branch `feature/clusters-artifact` → implement (TDD) → `npm test`/`npm run
lint` → project-review skill → push → PR → merge, per project convention.
This touches `artifacts.ts`, `orchestrate.ts`, `bin.ts`, and a skill doc —
above the "<10 lines" bar, so full review applies (not a
merge-directly-ask candidate).

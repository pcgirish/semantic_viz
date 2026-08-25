import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SymbolGraph } from "@scv/extractor";
import type { Edge, Snapshot, Unit } from "@scv/schema";
import {
  runClustersPass,
  runDocsPass,
  runFlowsPass,
  runFunctionsPass,
  runGroupsPass,
  runNarrationPass,
  systemIdFor,
  CLUSTERING_VERSION,
  layerIdFor,
  type DocExtract,
  type Layer,
  type Provider,
} from "@scv/interpreter";
import type { DiscoveredDoc } from "./discover-docs.js";
import { ancestorShas } from "./rev.js";

export type ArtifactName = "extraction" | "functions" | "docs" | "clusters" | "layers" | "groups" | "flows";

/**
 * Bumped whenever a cached artifact's *payload shape* changes without its inputs changing.
 * Folded into the input hash so a file written by an older binary is recomputed rather than
 * deserialized into a type it no longer matches. "2" = groups holds group units (Phase 3a);
 * "3" = layers holds the resolved layer records for carry-over (Phase 4c); "4" = layers is
 * split into a free `clusters` artifact + narration-only `layers`.
 */
export const ARTIFACT_SCHEMA_VERSION = "4";

/** Declared upstream artifacts each artifact must be fresh against before it can be computed. */
export const ARTIFACT_DEPENDENCIES: Record<ArtifactName, ArtifactName[]> = {
  extraction: [],
  functions: ["extraction"],
  docs: [],
  clusters: ["functions", "docs"],
  // `functions` is also reachable transitively via `clusters`, but is listed directly here too
  // because `computeArtifact("layers", ...)` needs real `Unit[]` objects in `deps`, not just
  // ids — `ensureArtifact` only populates `deps` for names in this array, not transitive ones.
  layers: ["clusters", "functions"],
  groups: ["layers", "functions"],
  flows: ["functions", "extraction"],
};

interface FunctionsData {
  units: Unit[];
  blockUnits: Unit[];
  blockEdges: Edge[];
}

export interface GroupsData {
  groupUnits: Unit[];
  /** Layer id -> group id, as entries so it survives a JSON round-trip. */
  layerParent: [string, string][];
}

export interface ClustersData {
  /** Layer id -> member file list, as entries so it survives a JSON round-trip. */
  groups: [string, string[]][];
  unitsByFile: [string, string[]][];
  repoContextText: string | undefined;
  modularity: number;
  directoryModularity: number;
  /** Invalidates the cache when the algorithm changes: a stored partition computed by an older
   *  clustering is not the partition this binary would produce from the same inputs. */
  clusteringVersion: string;
}

export interface LayersData {
  layerUnits: Unit[];
  /** The resolved layer records, the source the next run carries names and narration from. */
  layers: Layer[];
  parentOverride: [string, string][];
  layerIdByName: [string, string][];
  repoContextText: string | undefined;
  /** Invalidates the cache when the algorithm changes: a stored partition computed by an older
   *  clustering is not the partition this binary would produce from the same inputs. */
  clusteringVersion: string;
  promptRev: string;
}

export interface ArtifactDataMap {
  extraction: SymbolGraph;
  functions: FunctionsData;
  docs: DocExtract[];
  clusters: ClustersData;
  layers: LayersData;
  groups: GroupsData;
  flows: Unit[];
}

interface StoredArtifact<T> {
  inputHash: string;
  data: T;
}

export interface ArtifactContext {
  scvDir: string;
  sha: string;
  snapshot: Snapshot;
  graph: SymbolGraph;
  provider: Provider;
  promptRev: string;
  readSource: (file: string, start: number, end: number) => string;
  docs: DiscoveredDoc[];
  reportProgress: (phase: string, done: number, total: number, current?: string) => void;
  /** Artifact names to recompute even if their cached inputHash still matches. Only affects the
   *  exact artifact named in `ensureArtifact(name, ctx)` — recursively-fetched deps only
   *  force-recompute if they're themselves in this set, so downstream artifacts cascade only
   *  when the forced output actually changes (standard inputHash staleness), never upstream. */
  force: ReadonlySet<ArtifactName>;
  /** Layers from the nearest ancestor analysis with a cached layers artifact, keyed by structural
   *  id. Absent on a first analysis; every cluster is then named fresh. */
  previousLayers?: Map<string, Layer>;
  /** True for a `--no-llm` run. Informational only — actual no-provider gating happens via
   *  `EnsureArtifactOptions.allowProvider`, computed by the caller from this flag. */
  noLlm?: boolean;
}

function artifactFile(ctx: ArtifactContext, name: ArtifactName): string {
  return path.join(ctx.scvDir, "artifacts", ctx.sha, `${name}.json`);
}

function readArtifact<T>(ctx: ArtifactContext, name: ArtifactName): StoredArtifact<T> | undefined {
  const file = artifactFile(ctx, name);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as StoredArtifact<T>;
  } catch {
    return undefined;
  }
}

function writeArtifact<T>(ctx: ArtifactContext, name: ArtifactName, inputHash: string, data: T): void {
  const file = artifactFile(ctx, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ inputHash, data } satisfies StoredArtifact<T>));
}

function hashOf(...parts: string[]): string {
  return createHash("sha1").update(parts.join("\0")).digest("hex");
}

function graphHash(graph: SymbolGraph): string {
  return hashOf(
    graph.units.map((u) => `${u.id}:${u.hash.struct}:${u.hash.text}`).join("\n"),
    graph.edges.map((e) => `${e.from}>${e.to}:${e.kind}`).join("\n"),
  );
}

export async function computeInputHash(name: ArtifactName, ctx: ArtifactContext, deps: Partial<ArtifactDataMap>): Promise<string> {
  switch (name) {
    case "extraction":
      // Static, not LLM-derived — no promptRev dependency.
      return graphHash(ctx.graph);
    case "functions":
      return hashOf(graphHash(ctx.graph), ctx.promptRev);
    case "docs":
      return hashOf(ctx.docs.map((d) => `${d.path}:${d.content}`).join("\n"), ctx.promptRev);
    case "clusters": {
      const functions = deps.functions as FunctionsData;
      const docs = deps.docs as DocExtract[];
      return hashOf(
        functions.units.map((u) => `${u.id}:${u.semantics?.what ?? ""}`).join("\n"),
        ctx.snapshot.edges.map((e) => `${e.from}>${e.to}`).join("\n"),
        JSON.stringify(docs),
        CLUSTERING_VERSION,
        ARTIFACT_SCHEMA_VERSION,
      );
    }
    case "layers": {
      const clusters = deps.clusters as ClustersData;
      const functions = deps.functions as FunctionsData;
      return hashOf(
        clusters.groups.map(([id, files]) => `${id}:${files.join(",")}`).join("\n"),
        JSON.stringify(clusters.unitsByFile),
        clusters.repoContextText ?? "",
        functions.units.map((u) => `${u.id}:${u.semantics?.what ?? ""}`).join("\n"),
        ctx.promptRev,
        ARTIFACT_SCHEMA_VERSION,
      );
    }
    case "groups": {
      const layers = deps.layers as LayersData;
      return hashOf(
        layers.layerUnits.map((l) => `${l.id}:${l.name}:${l.semantics?.why ?? ""}`).join("\n"),
        ctx.snapshot.edges.map((e) => `${e.from}>${e.to}`).join("\n"),
        ctx.promptRev,
        ARTIFACT_SCHEMA_VERSION,
      );
    }
    case "flows": {
      const functions = deps.functions as FunctionsData;
      return hashOf(
        functions.units.map((u) => `${u.id}:${u.semantics?.what ?? ""}`).join("\n"),
        graphHash(ctx.graph),
        ctx.promptRev,
      );
    }
  }
}

async function computeArtifact(name: ArtifactName, ctx: ArtifactContext, deps: Partial<ArtifactDataMap>): Promise<ArtifactDataMap[ArtifactName]> {
  switch (name) {
    case "extraction":
      return ctx.graph;
    case "functions":
      return runFunctionsPass({
        snapshot: ctx.snapshot,
        graph: ctx.graph,
        provider: ctx.provider,
        promptRev: ctx.promptRev,
        readSource: ctx.readSource,
        reportProgress: ctx.reportProgress,
      });
    case "docs":
      return runDocsPass({
        docs: ctx.docs,
        provider: ctx.provider,
        promptRev: ctx.promptRev,
        reportProgress: ctx.reportProgress,
      });
    case "clusters": {
      const functions = deps.functions as FunctionsData;
      const docExtracts = deps.docs as DocExtract[];
      const result = runClustersPass({
        snapshot: ctx.snapshot,
        units: functions.units,
        docExtracts,
        reportProgress: ctx.reportProgress,
      });
      const clustersData: ClustersData = {
        groups: [...result.groups],
        unitsByFile: [...result.unitsByFile].map(([file, units]) => [file, units.map((u) => u.id)]),
        repoContextText: result.repoContextText,
        modularity: result.modularity,
        directoryModularity: result.directoryModularity,
        clusteringVersion: CLUSTERING_VERSION,
      };
      return clustersData;
    }
    case "layers": {
      const clusters = deps.clusters as ClustersData;
      const functions = deps.functions as FunctionsData;
      const unitsById = new Map(functions.units.map((u) => [u.id, u]));
      const unitsByFile = new Map<string, Unit[]>(
        clusters.unitsByFile.map(([file, ids]) => [file, ids.flatMap((id) => (unitsById.has(id) ? [unitsById.get(id)!] : []))]),
      );
      const result = await runNarrationPass({
        clusters: {
          groups: new Map(clusters.groups),
          unitsByFile,
          repoContextText: clusters.repoContextText,
          modularity: clusters.modularity,
          directoryModularity: clusters.directoryModularity,
        },
        units: functions.units,
        provider: ctx.provider,
        promptRev: ctx.promptRev,
        reportProgress: ctx.reportProgress,
        previousLayers: ctx.previousLayers,
      });
      const layersData: LayersData = {
        layerUnits: result.layerUnits,
        layers: result.layers,
        parentOverride: [...result.parentOverride],
        layerIdByName: [...result.layerIdByName],
        repoContextText: clusters.repoContextText,
        clusteringVersion: CLUSTERING_VERSION,
        promptRev: ctx.promptRev,
      };
      return layersData;
    }
    case "groups": {
      const layers = deps.layers as LayersData;
      const functions = deps.functions as FunctionsData;
      const grouped = await runGroupsPass({
        snapshot: ctx.snapshot,
        layerUnits: layers.layerUnits,
        parentOverride: new Map(layers.parentOverride),
        unitsByFile: unitsByFileFrom(functions.units),
        layerIdByName: new Map(layers.layerIdByName),
        repoContextText: layers.repoContextText,
        // Matches `finalizeSnapshot`'s own derivation at the analyze call site, which passes no
        // `systemName`; groups must parent to the same system id the snapshot will build.
        systemId: systemIdFor(ctx.snapshot),
        provider: ctx.provider,
        promptRev: ctx.promptRev,
        reportProgress: ctx.reportProgress,
      });
      const groupsData: GroupsData = { groupUnits: grouped.groupUnits, layerParent: [...grouped.layerParent] };
      return groupsData;
    }
    case "flows": {
      const functions = deps.functions as FunctionsData;
      return runFlowsPass({
        snapshot: ctx.snapshot,
        graph: ctx.graph,
        units: functions.units,
        provider: ctx.provider,
        promptRev: ctx.promptRev,
        reportProgress: ctx.reportProgress,
      });
    }
  }
}

function unitsByFileFrom(units: Unit[]): Map<string, Unit[]> {
  const map = new Map<string, Unit[]>();
  for (const unit of units) {
    if (unit.kind !== "module") continue;
    for (const file of unit.loc.files) {
      (map.get(file) ?? map.set(file, []).get(file)!).push(unit);
    }
  }
  return map;
}

function emptyArtifactDefault<N extends ArtifactName>(name: N, ctx: ArtifactContext): ArtifactDataMap[N] {
  const defaults: ArtifactDataMap = {
    extraction: ctx.graph,
    functions: { units: ctx.snapshot.units, blockUnits: [], blockEdges: [] },
    docs: [],
    clusters: {
      groups: [],
      unitsByFile: [],
      repoContextText: undefined,
      modularity: 0,
      directoryModularity: 0,
      clusteringVersion: CLUSTERING_VERSION,
    },
    layers: {
      layerUnits: [],
      layers: [],
      parentOverride: [],
      layerIdByName: [],
      repoContextText: undefined,
      clusteringVersion: CLUSTERING_VERSION,
      promptRev: ctx.promptRev,
    },
    groups: { groupUnits: [], layerParent: [] },
    flows: [],
  };
  return defaults[name] as ArtifactDataMap[N];
}

export interface EnsureArtifactOptions {
  /** Names allowed to call the provider on a cache miss/staleness. Absent = every artifact may
   *  call the provider (today's full-pipeline default). Present and not containing `name` = use
   *  `emptyArtifactDefault` instead of computing. */
  allowProvider?: ReadonlySet<ArtifactName>;
}

export interface EnsuredArtifact<T> {
  data: T;
  /** Every artifact name that was empty-defaulted anywhere in this call's dependency recursion,
   *  including `name` itself if it was defaulted. A dependency resolved from a real, fresh cache
   *  entry is never in this set, even if its own payload happens to be empty. */
  defaultedArtifacts: Set<ArtifactName>;
}

/** Walks `ARTIFACT_DEPENDENCIES` from `name`, returning `name` plus every name transitively
 *  reachable from it. Used to scope `allowProvider` to a targeted artifact's dependency closure. */
export function dependencyClosure(name: ArtifactName): Set<ArtifactName> {
  const closure = new Set<ArtifactName>();
  const visit = (n: ArtifactName): void => {
    if (closure.has(n)) return;
    closure.add(n);
    for (const dep of ARTIFACT_DEPENDENCIES[n]) visit(dep);
  };
  visit(name);
  return closure;
}

/**
 * Freshens `name`'s dependencies first (recursively), then reuses the persisted artifact at
 * `.scv/artifacts/<sha>/<name>.json` if its stored inputHash still matches; otherwise recomputes
 * it via the corresponding interpreter pass and persists the result — unless `opts.allowProvider`
 * excludes `name`, in which case an empty default is returned instead of calling the provider.
 */
/**
 * Reads a previously-analyzed commit's layers, keyed by structural id, for carry-over. Walks
 * HEAD's first-parent ancestry and stops at the first sha with a usable cached layers artifact.
 *
 * Degrades to an empty map on anything unexpected — an unreadable file, an older payload shape,
 * a different clustering version, a different prompt revision. A missed carry-over costs Pass C
 * calls, never correctness.
 *
 * `promptRev` must match because a hit skips the Pass C call outright: the artifact input hash
 * folds the prompt revision in, but that only re-narrates clusters that actually call the LLM.
 * Without this check a prompt change would leave carried-over layers describing themselves in
 * the old prompt's terms, alongside freshly-narrated siblings using the new one.
 */
export function loadPreviousLayers(scvDir: string, root: string, promptRev: string): Map<string, Layer> {
  for (const sha of ancestorShas(root)) {
    const file = path.join(scvDir, "artifacts", sha, "layers.json");
    if (!existsSync(file)) continue;
    try {
      const stored = JSON.parse(readFileSync(file, "utf-8")) as StoredArtifact<LayersData>;
      const layers = stored.data?.layers;
      if (!Array.isArray(layers)) continue;
      if (stored.data.clusteringVersion !== CLUSTERING_VERSION) continue;
      if (stored.data.promptRev !== promptRev) continue;
      return new Map(layers.map((layer) => [layerIdFor(layer.files), layer]));
    } catch {
      continue;
    }
  }
  return new Map();
}

export async function ensureArtifact<N extends ArtifactName>(
  name: N,
  ctx: ArtifactContext,
  opts?: EnsureArtifactOptions,
): Promise<EnsuredArtifact<ArtifactDataMap[N]>> {
  const defaultedArtifacts = new Set<ArtifactName>();
  const deps: Partial<ArtifactDataMap> = {};
  for (const dep of ARTIFACT_DEPENDENCIES[name]) {
    const depResult = await ensureArtifact(dep, ctx, opts);
    (deps as Record<ArtifactName, unknown>)[dep] = depResult.data;
    for (const d of depResult.defaultedArtifacts) defaultedArtifacts.add(d);
  }

  const inputHash = await computeInputHash(name, ctx, deps);
  const stored = readArtifact<ArtifactDataMap[N]>(ctx, name);
  const fresh = stored && stored.inputHash === inputHash && !ctx.force.has(name);
  // `extraction` never calls a provider to begin with — always compute it for real, regardless
  // of `allowProvider`; it can never be empty-defaulted.
  const mayCallProvider = name === "extraction" || !opts?.allowProvider || opts.allowProvider.has(name);

  if (!fresh && !mayCallProvider) {
    defaultedArtifacts.add(name);
    return { data: emptyArtifactDefault(name, ctx), defaultedArtifacts };
  }
  if (fresh) return { data: stored.data, defaultedArtifacts };

  const data = (await computeArtifact(name, ctx, deps)) as ArtifactDataMap[N];
  writeArtifact(ctx, name, inputHash, data);
  return { data, defaultedArtifacts };
}

/** Thin wrapper for call sites that only need the data, not the `defaultedArtifacts` set. */
export async function ensureArtifactData<N extends ArtifactName>(
  name: N,
  ctx: ArtifactContext,
  opts?: EnsureArtifactOptions,
): Promise<ArtifactDataMap[N]> {
  return (await ensureArtifact(name, ctx, opts)).data;
}

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SymbolGraph } from "@scv/extractor";
import type { Edge, Snapshot, Unit } from "@scv/schema";
import {
  buildBlockUnits,
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
  type PassAUnitRecord,
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

/**
 * Stages whose own pass never calls a provider. They are always computed for real, regardless of
 * `allowProvider`, which gates only provider-backed stages. Their provider-backed *dependencies*
 * are still subject to it — `clusters` is deterministic (`pass-b.ts`, "no longer an LLM pass"),
 * but it consumes `functions` and `docs`, which are not.
 */
const DETERMINISTIC_ARTIFACTS: ReadonlySet<ArtifactName> = new Set<ArtifactName>(["extraction", "clusters"]);

/** The skill that produces each artifact, named in `DefaultedArtifactsError` so the message says
 *  what to run rather than only what is missing. */
const PRODUCING_SKILL: Partial<Record<ArtifactName, string>> = {
  functions: "agent-analyze-functions",
  docs: "agent-analyze-docs",
  layers: "agent-analyze-layers",
  groups: "agent-analyze-groups",
  flows: "agent-analyze-flows",
};

/**
 * Thrown when a deterministic artifact was asked for under `requireFreshDependencies` but one of
 * its dependencies had to be empty-defaulted. Computing anyway would write a cache-fresh artifact
 * derived from empty inputs, indistinguishable from a good one and silently reused by the next run.
 */
export class DefaultedArtifactsError extends Error {
  readonly defaultedArtifacts: ArtifactName[];

  constructor(target: ArtifactName, defaultedArtifacts: ArtifactName[]) {
    const detail = defaultedArtifacts
      .map((name) => (PRODUCING_SKILL[name] ? `${name} (run ${PRODUCING_SKILL[name]})` : name))
      .join(", ");
    super(`cannot compute ${target}: these dependencies are not narrated — ${detail}`);
    this.name = "DefaultedArtifactsError";
    this.defaultedArtifacts = defaultedArtifacts;
  }
}

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
  /** True when this file was flushed mid-pass, or by a scoped/failed run. A partial artifact is
   *  readable but never fresh — the next run recomputes, which the per-unit store makes cheap. */
  partial?: boolean;
  data: T;
}

/**
 * Pass A persistence, owned by the CLI so the interpreter stays free of the cache DB. Supplied
 * by `analyze.ts`; absent for callers that don't resume (tests, `--no-llm` without a cache).
 */
export interface PassAStore {
  /** Completed units from an earlier run, keyed by unit id, already matched on struct hash. */
  prior: Map<string, PassAUnitRecord>;
  /** Durably record one unit's outcome the moment it resolves. */
  record: (id: string, unit: Unit, status: "ok" | "failed") => void;
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
  /** Unit ids Pass A is restricted to (`--scope`). Absent means the whole repo. */
  scopedLeafIds?: ReadonlySet<string>;
  /** Stable text identifying the scope, folded into the `functions` input hash so a scoped run
   *  and a full run never read each other's artifact as fresh. */
  scopeKey?: string;
  /** Per-unit Pass A persistence, enabling resume across interrupted runs. */
  passAStore?: PassAStore;
}

function artifactFile(ctx: ArtifactContext, name: ArtifactName): string {
  return path.join(ctx.scvDir, "artifacts", ctx.sha, `${name}.json`);
}

export function readArtifact<T>(ctx: ArtifactContext, name: ArtifactName): StoredArtifact<T> | undefined {
  const file = artifactFile(ctx, name);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as StoredArtifact<T>;
  } catch {
    return undefined;
  }
}

/** Writes via a sibling temp file + rename, so a kill mid-write leaves the previous file intact
 *  rather than a truncated one — the incremental Pass A flush depends on that. */
function writeArtifact<T>(ctx: ArtifactContext, name: ArtifactName, inputHash: string, data: T, partial = false): void {
  const file = artifactFile(ctx, name);
  mkdirSync(path.dirname(file), { recursive: true });
  const stored: StoredArtifact<T> = partial ? { inputHash, partial: true, data } : { inputHash, data };
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(stored));
  renameSync(temp, file);
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
      // Scope is in the key so a slice's artifact is never mistaken for a whole-repo one.
      return hashOf(graphHash(ctx.graph), ctx.promptRev, ctx.scopeKey ?? "all");
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

/** Units completed between flushes before `functions.json` is rewritten. The artifact is large,
 *  so flushing per unit would dominate the pass; anything newer than the last flush is still
 *  recoverable from `pass_a_units`. */
const PASS_A_FLUSH_EVERY = 10;

/** Computed data, plus whether it may be recorded as a complete (fresh-able) artifact. */
interface ComputedArtifact {
  data: ArtifactDataMap[ArtifactName];
  partial: boolean;
}

async function computeArtifact(name: ArtifactName, ctx: ArtifactContext, deps: Partial<ArtifactDataMap>, inputHash: string): Promise<ComputedArtifact> {
  switch (name) {
    case "extraction":
      return { data: ctx.graph, partial: false };
    case "functions": {
      const store = ctx.passAStore;
      // Rebuilt on each flush from the units resolved so far, so an interrupted run still leaves
      // a readable `functions.json` carrying the work already paid for.
      const completed = new Map<string, Unit>();
      let sinceFlush = 0;
      // Blocks are pure AST structure and label-independent, so they are built once up front and
      // reused by every flush — an interrupted run must still leave a flowchart-capable artifact,
      // and this is the path most likely to be hit on a large repo.
      const flushBlocks = buildBlockUnits(ctx.snapshot.units, ctx.graph);
      const flush = (): void => {
        const merged = ctx.snapshot.units.map((u) => completed.get(u.id) ?? u);
        const byId = new Map(merged.map((u) => [u.id, u]));
        const units = flushBlocks.unitsWithBlockChildren.map((u) => {
          const resolved = byId.get(u.id);
          return resolved ? { ...resolved, children: u.children } : u;
        });
        writeArtifact(
          ctx,
          "functions",
          inputHash,
          { units, blockUnits: flushBlocks.blockUnits, blockEdges: flushBlocks.blockEdges } satisfies FunctionsData,
          true,
        );
      };

      const result = await runFunctionsPass({
        snapshot: ctx.snapshot,
        graph: ctx.graph,
        provider: ctx.provider,
        promptRev: ctx.promptRev,
        readSource: ctx.readSource,
        reportProgress: ctx.reportProgress,
        scopedLeafIds: ctx.scopedLeafIds,
        priorResults: store?.prior,
        onUnitComplete: (id, unit, status) => {
          store?.record(id, unit, status);
          if (status === "ok") completed.set(id, unit);
          if (++sinceFlush >= PASS_A_FLUSH_EVERY) {
            sinceFlush = 0;
            flush();
          }
        },
      });

      const { units, blockUnits, blockEdges, attemptedAll, failedCount } = result;
      // Only a run that attempted every unit and failed none may be recorded as complete;
      // anything else stays partial so the next run picks up where this one stopped.
      return { data: { units, blockUnits, blockEdges }, partial: !attemptedAll || failedCount > 0 };
    }
    case "docs":
      return {
        data: await runDocsPass({
          docs: ctx.docs,
          provider: ctx.provider,
          promptRev: ctx.promptRev,
          reportProgress: ctx.reportProgress,
        }),
        partial: false,
      };
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
      return { data: clustersData, partial: false };
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
      return { data: layersData, partial: false };
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
      return { data: groupsData, partial: false };
    }
    case "flows": {
      const functions = deps.functions as FunctionsData;
      return {
        data: await runFlowsPass({
          snapshot: ctx.snapshot,
          graph: ctx.graph,
          units: functions.units,
          provider: ctx.provider,
          promptRev: ctx.promptRev,
          reportProgress: ctx.reportProgress,
        }),
        partial: false,
      };
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
  // Handled ahead of the `defaults` literal, which is evaluated in full on every call: even an
  // empty-defaulted functions artifact carries real blocks (they need no LLM, and leaving them
  // out is what blanks the Flowchart view on the zero-LLM paths), but walking the block graph
  // is wasted work for every other artifact name.
  if (name === "functions") {
    const built = buildBlockUnits(ctx.snapshot.units, ctx.graph);
    return { units: built.unitsWithBlockChildren, blockUnits: built.blockUnits, blockEdges: built.blockEdges } as ArtifactDataMap[N];
  }

  const defaults: ArtifactDataMap = {
    extraction: ctx.graph,
    functions: { units: ctx.snapshot.units, blockUnits: [], blockEdges: [] }, // unreachable — see above
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
  /** Throw `DefaultedArtifactsError` instead of computing `name` if any dependency was
   *  empty-defaulted. Set only on the targeted `--no-llm` path; absent everywhere else. */
  requireFreshDependencies?: boolean;
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

/**
 * What a `--no-llm` run reads when the artifact is not fresh. For `functions` a partial artifact
 * is usable but not authoritative: debouncing means units can be complete in `pass_a_units` yet
 * absent from the last flush, so the durable store is overlaid on top of it. Other artifacts have
 * no per-unit store and fall back to the structural default.
 */
function noLlmFallback<N extends ArtifactName>(
  name: N,
  ctx: ArtifactContext,
  stored: StoredArtifact<ArtifactDataMap[N]> | undefined,
  inputHash: string,
): ArtifactDataMap[N] {
  if (name !== "functions") return emptyArtifactDefault(name, ctx);

  // Only this run's own artifact may serve as the base. `stored` reaches here precisely because
  // it was not fresh, so it can be a *different* run's output — a prior unscoped run, an older
  // prompt rev, or pre-edit sources — and adopting its units would surface semantics that do not
  // belong to the current inputs (out-of-scope units under `--scope`, stale text otherwise).
  // A partial artifact is usable only when its hash matches: that is this run, interrupted.
  const usable = stored && stored.inputHash === inputHash ? (stored.data as FunctionsData) : undefined;
  const base = usable ?? (emptyArtifactDefault("functions", ctx) as FunctionsData);
  const byId = new Map(base.units.map((u) => [u.id, u]));
  for (const [id, record] of ctx.passAStore?.prior ?? []) {
    if (record.status !== "ok") continue;
    // Scope is part of this artifact's identity (it is folded into the input hash), so a scoped
    // merge reports only in-scope units. The store keeps every unit an earlier run completed;
    // replaying all of them here would ignore the scope the caller asked for.
    if (ctx.scopedLeafIds && !ctx.scopedLeafIds.has(id)) continue;
    // Only the analysis is taken from the store. A stored record predates block linkage — Pass A
    // reports each unit before block children are appended — so adopting it wholesale would drop
    // the `children` entries that `base.blockUnits` still points at, and the snapshot would fail
    // its parent/child invariant.
    const structural = byId.get(id) ?? ctx.snapshot.units.find((u) => u.id === id);
    if (!structural) continue;
    const { semantics, cost, tags, hash, provenance, signature } = record.unit;
    byId.set(id, { ...structural, semantics, cost, tags, hash, provenance, signature });
  }
  const merged: FunctionsData = {
    units: ctx.snapshot.units.map((u) => byId.get(u.id) ?? u),
    blockUnits: base.blockUnits,
    blockEdges: base.blockEdges,
  };
  return merged as ArtifactDataMap[N];
}

export async function ensureArtifact<N extends ArtifactName>(
  name: N,
  ctx: ArtifactContext,
  opts?: EnsureArtifactOptions,
): Promise<EnsuredArtifact<ArtifactDataMap[N]>> {
  const defaultedArtifacts = new Set<ArtifactName>();
  const deps: Partial<ArtifactDataMap> = {};
  for (const dep of ARTIFACT_DEPENDENCIES[name]) {
    // `requireFreshDependencies` is deliberately not propagated: a dependency is *allowed* to
    // empty-default here — that is exactly what this call is measuring. Only the target the caller
    // named refuses to be computed over defaults.
    const depResult = await ensureArtifact(dep, ctx, { allowProvider: opts?.allowProvider });
    (deps as Record<ArtifactName, unknown>)[dep] = depResult.data;
    for (const d of depResult.defaultedArtifacts) defaultedArtifacts.add(d);
  }

  // Before the target is computed or written, so a failed precondition leaves no artifact behind:
  // a clusters.json derived from empty defaults would read as fresh to the next run.
  if (opts?.requireFreshDependencies && defaultedArtifacts.size > 0) {
    throw new DefaultedArtifactsError(name, [...defaultedArtifacts]);
  }

  const inputHash = await computeInputHash(name, ctx, deps);
  const stored = readArtifact<ArtifactDataMap[N]>(ctx, name);
  // A partial artifact is readable but never fresh: it is missing units by construction, and the
  // per-unit store makes recomputing it cheap.
  const fresh = stored && stored.inputHash === inputHash && !stored.partial && !ctx.force.has(name);
  // A deterministic stage never calls a provider to begin with — always compute it for real,
  // regardless of `allowProvider`; it can never be empty-defaulted.
  const mayCallProvider = DETERMINISTIC_ARTIFACTS.has(name) || !opts?.allowProvider || opts.allowProvider.has(name);

  if (!fresh && !mayCallProvider) {
    defaultedArtifacts.add(name);
    return { data: noLlmFallback(name, ctx, stored, inputHash), defaultedArtifacts };
  }
  if (fresh) return { data: stored.data, defaultedArtifacts };

  const computed = await computeArtifact(name, ctx, deps, inputHash);
  writeArtifact(ctx, name, inputHash, computed.data, computed.partial);
  return { data: computed.data as ArtifactDataMap[N], defaultedArtifacts };
}

/** Thin wrapper for call sites that only need the data, not the `defaultedArtifacts` set. */
export async function ensureArtifactData<N extends ArtifactName>(
  name: N,
  ctx: ArtifactContext,
  opts?: EnsureArtifactOptions,
): Promise<ArtifactDataMap[N]> {
  return (await ensureArtifact(name, ctx, opts)).data;
}

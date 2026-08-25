import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractRepo, isGeneratedPath, isTestPath, type SymbolGraph } from "@scv/extractor";
import { PendingSemanticsSchema, SnapshotSchema, semanticHashInput, type Edge, type Snapshot, type Unit } from "@scv/schema";
import { runPassB, layerIdFor, CLUSTERING_VERSION, type DocExtract, type ImportEdge, type Layer, type Provider } from "@scv/interpreter";
import { computeInputHash, type ArtifactContext, type ArtifactName } from "./artifacts.js";
import { assembleSnapshotFromCache } from "./assemble-snapshot.js";
import { discoverDocs } from "./discover-docs.js";
import { changedFiles, headRev } from "./rev.js";
import { toSnapshot } from "./snapshot.js";

interface FunctionsData {
  units: Unit[];
  blockUnits: Unit[];
  blockEdges: unknown[];
}

interface ClustersData {
  groups: [string, string[]][];
  unitsByFile: [string, string[]][];
  repoContextText: string | undefined;
  modularity: number;
  directoryModularity: number;
  clusteringVersion: string;
}

interface LayersData {
  layerUnits: Unit[];
  layers: Layer[];
  parentOverride: [string, string][];
  layerIdByName: [string, string][];
  repoContextText: string | undefined;
  clusteringVersion: string;
  promptRev: string;
}

interface StoredArtifact<T> {
  inputHash: string;
  data: T;
}

export interface MergeSemanticsOptions {
  pendingFile: string;
  ctx: ArtifactContext;
  /** Filesystem repo root, used by `--scope changed` to run `git diff` against. `ctx.snapshot.repo.root`
   *  is a display name (`path.basename`), not a usable path, so this must be passed separately. */
  root: string;
  scope?: string[];
  withClustering?: boolean;
}

export interface MergeSemanticsResult {
  merged: number;
  skipped: number;
  warnings: string[];
}

export interface RunMergeSemanticsResult extends MergeSemanticsResult {
  snapshot: Snapshot;
  path: string;
  emptyArtifacts: ArtifactName[];
}

function artifactFile(ctx: ArtifactContext, name: string): string {
  return path.join(ctx.scvDir, "artifacts", ctx.sha, `${name}.json`);
}

function readArtifact<T>(ctx: ArtifactContext, name: string): StoredArtifact<T> | undefined {
  const file = artifactFile(ctx, name);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as StoredArtifact<T>;
  } catch {
    return undefined;
  }
}

function writeArtifact<T>(ctx: ArtifactContext, name: string, inputHash: string, data: T): void {
  const file = artifactFile(ctx, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ inputHash, data } satisfies StoredArtifact<T>));
}

/** Converts a `--scope` glob (`*` = one path segment, `**` = any depth) to a matcher against
 *  dotted unit ids/qualnames (e.g. `u:src.handlers.create_order`), where `.` is the segment
 *  separator. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped
    .replace(/\*\*/g, " ")
    .replace(/\*/g, "[^.]*")
    .replace(/ /g, ".*");
  return new RegExp(`^${pattern}$`);
}

/**
 * `--scope` semantics per the plan: `all` (or omitted) matches every entry; `changed` matches
 * units whose file appears in `git diff --name-only HEAD~1 HEAD`; anything else is a glob
 * matched against the unit id.
 */
function inScope(unit: { id: string; loc: { files: string[] } }, scope: string[] | undefined, root: string): boolean {
  if (!scope || scope.length === 0 || scope.includes("all")) return true;

  return scope.some((pattern) => {
    if (pattern === "changed") {
      const changed = changedFiles(root);
      return unit.loc.files.some((f) => changed.includes(f));
    }
    return globToRegExp(pattern).test(unit.id);
  });
}

export interface RunMergeSemanticsOptions {
  root: string;
  pendingFile: string;
  scvDir?: string;
  scope?: string[];
  withClustering?: boolean;
  sha?: string;
}

const noopProvider: Provider = {
  name: "none",
  model: "none",
  interpret: () => {
    throw new Error("merge-semantics must never call the provider");
  },
};

const STRUCTURAL_KINDS = new Set(["module", "class", "function"]);
const STRUCTURAL_EDGE_KINDS = new Set(["imports", "calls", "inherits"]);

/** Rebuilds a `SymbolGraph`-shaped object from a persisted structural snapshot's units/edges.
 *  Exact for hashing: `toUnit`/`toEdge` (in snapshot.ts) copy `hash.struct`/`hash.text`/`from`/
 *  `to`/`kind` verbatim from the original `SymbolGraph`, so `graphHash` over this reconstruction
 *  matches what it was when the snapshot was written — the other `SymbolUnit`/`SymbolEdge`
 *  fields (`params`, `returns`, `bases`, `metrics`, `authors`, `evidence`, `confidence`) are
 *  never read by anything `merge-semantics` calls (no pass runs; only `graphHash` inspects
 *  `graph`). Non-structural units (layer/group/api_flow/block/etc., only present in a
 *  post-LLM snapshot) are dropped — raw extraction never emits those kinds either. */
function graphFromSnapshot(snapshot: Snapshot): SymbolGraph {
  const structuralUnits = snapshot.units.filter(
    (u): u is Unit & { kind: "module" | "class" | "function" } => STRUCTURAL_KINDS.has(u.kind),
  );
  return {
    units: structuralUnits.map((u) => ({
      id: u.id,
      kind: u.kind,
      name: u.name,
      qualname: u.qualname,
      lang: u.lang ?? "",
      parent: u.parent,
      children: u.children,
      loc: { file: u.loc.files[0] ?? "", start: u.loc.start ?? 0, end: u.loc.end ?? 0 },
      sloc: u.loc.sloc,
      params: [],
      returns: null,
      bases: [],
      hash: { struct: u.hash.struct ?? "", text: u.hash.text ?? "" },
      metrics: { fanIn: u.metrics.fan_in ?? 0, fanOut: u.metrics.fan_out ?? 0, churn: u.metrics.churn ?? 0, commits: u.metrics.commits ?? 0 },
      authors: u.authors ?? [],
    })),
    edges: snapshot.edges
      .filter((e): e is Edge & { kind: "imports" | "calls" | "inherits" } => STRUCTURAL_EDGE_KINDS.has(e.kind))
      .map((e) => ({
        id: e.id,
        from: e.from,
        to: e.to,
        kind: e.kind,
        confidence: e.confidence,
        evidence: e.evidence?.[0] ?? { file: "", line: 0 },
      })),
    externals: [],
    blockGraph: {},
    routes: [],
  };
}

function loadPersistedSnapshot(scvDir: string, sha: string): Snapshot | undefined {
  const file = path.join(scvDir, "snapshots", `${sha}.json`);
  if (!existsSync(file)) return undefined;
  try {
    return SnapshotSchema.parse(JSON.parse(readFileSync(file, "utf-8")));
  } catch {
    return undefined;
  }
}

/** CLI entry point: builds an `ArtifactContext` from `root` (no provider, no LLM calls — merge
 *  is purely file-based) and runs `mergeSemantics` against it. When `--sha` names a commit with
 *  a persisted `.scv/snapshots/<sha>.json` (e.g. from a prior `--no-llm` run), merges against
 *  that structural snapshot instead of the current worktree — extraction has no historical-sha
 *  capability, so this is the only way to merge against a non-HEAD revision. Falls back to live
 *  extraction of the current worktree when no such snapshot exists. */
export async function runMergeSemantics(options: RunMergeSemanticsOptions): Promise<RunMergeSemanticsResult> {
  const scvDir = options.scvDir ?? path.join(options.root, ".scv");
  const rev = options.sha ? { sha: options.sha, kind: "commit" as const, ts: "", author: "", author_kind: "human" as const } : headRev(options.root);

  const persisted = loadPersistedSnapshot(scvDir, rev.sha);
  const graph = persisted ? graphFromSnapshot(persisted) : extractRepo(options.root, path.join(scvDir, "artifacts", "extraction-files"));
  const snapshot = persisted ?? toSnapshot(graph, { root: options.root, rev });

  const ctx: ArtifactContext = {
    scvDir,
    sha: rev.sha,
    snapshot,
    graph,
    provider: noopProvider,
    promptRev: "p4",
    readSource: () => "",
    docs: discoverDocs(options.root),
    reportProgress: () => {},
    force: new Set(),
    noLlm: true,
  };

  const mergeResult = await mergeSemantics({ pendingFile: options.pendingFile, ctx, root: options.root, scope: options.scope, withClustering: options.withClustering });
  const assembled = await assembleSnapshotFromCache({ ctx, rev, scvDir });

  return { ...mergeResult, snapshot: assembled.snapshot, path: assembled.path, emptyArtifacts: assembled.emptyArtifacts };
}

export async function mergeSemantics(options: MergeSemanticsOptions): Promise<MergeSemanticsResult> {
  const { pendingFile, ctx, root, scope, withClustering } = options;
  const warnings: string[] = [];

  const raw = JSON.parse(readFileSync(pendingFile, "utf-8"));
  const pending = PendingSemanticsSchema.parse(raw);

  const functionsStored = readArtifact<FunctionsData>(ctx, "functions");
  const functionsData: FunctionsData = functionsStored?.data ?? {
    units: ctx.snapshot.units,
    blockUnits: [],
    blockEdges: [],
  };

  const unitById = new Map(functionsData.units.map((u) => [u.id, u]));

  let merged = 0;
  let skipped = 0;

  for (const [id, entry] of Object.entries(pending.units)) {
    const unit = unitById.get(id);
    if (!unit) {
      warnings.push(`unit ${id} not found in current extraction — skipped`);
      skipped++;
      continue;
    }
    if (!inScope(unit, scope, root)) continue;
    if (unit.kind !== entry.kind) {
      warnings.push(`unit ${id} has kind "${unit.kind}", pending entry declares "${entry.kind}" — skipped`);
      skipped++;
      continue;
    }

    const semantics = entry.semantics
      ? { ...entry.semantics, source: "manual" as const }
      : unit.semantics;

    const mergedUnit: Unit = {
      ...unit,
      semantics: semantics ?? unit.semantics,
      cost: entry.cost ? { ...entry.cost, source: "manual" as const } : unit.cost,
      tags: entry.tags ?? unit.tags,
      signature: entry.signature ?? unit.signature,
      hash: {
        ...unit.hash,
        semantic: createHash("sha1").update(semanticHashInput(unit.name, semantics ?? null)).digest("hex"),
      },
      provenance: { source: "manual", pass: "A" },
    };

    unitById.set(id, mergedUnit);
    merged++;
  }

  functionsData.units = [...unitById.values()];

  const functionsInputHash = await computeInputHash("functions", ctx, {});
  writeArtifact(ctx, "functions", functionsInputHash, functionsData);

  if (withClustering) {
    const clusterResult = await mergeLayerClustering(ctx, pending.layers, functionsData.units, warnings);
    merged += clusterResult.merged;
    skipped += clusterResult.skipped;
  }

  return { merged, skipped, warnings };
}

async function mergeLayerClustering(
  ctx: ArtifactContext,
  pendingLayers: Record<string, { name: string; files: string[]; what: string; how: string; when: string; where: string; why: string; confidence: number }>,
  functionUnits: Unit[],
  warnings: string[],
): Promise<{ merged: number; skipped: number }> {
  const unitsByFile = new Map<string, Unit[]>();
  for (const unit of functionUnits) {
    if (unit.kind !== "module") continue;
    const file = unit.loc.files[0];
    if (!file || isTestPath(file) || isGeneratedPath(file)) continue;
    (unitsByFile.get(file) ?? unitsByFile.set(file, []).get(file)!).push(unit);
  }
  const files = [...unitsByFile.keys()];

  const fileOfUnit = new Map<string, string>();
  for (const unit of functionUnits) {
    if (unit.loc.files[0]) fileOfUnit.set(unit.id, unit.loc.files[0]);
  }

  const importEdges: ImportEdge[] = [];
  const edgeWeightByFilePair = new Map<string, number>();
  for (const edge of ctx.snapshot.edges) {
    const fromFile = fileOfUnit.get(edge.from);
    const toFile = fileOfUnit.get(edge.to);
    if (!fromFile || !toFile || fromFile === toFile) continue;
    const key = `${fromFile} ${toFile}`;
    edgeWeightByFilePair.set(key, (edgeWeightByFilePair.get(key) ?? 0) + edge.weight);
  }
  for (const [key, weight] of edgeWeightByFilePair) {
    const [from, to] = key.split(" ") as [string, string];
    importEdges.push({ from, to, weight });
  }

  const passB = runPassB({ files, edges: importEdges });

  const pendingByRealId = new Map<string, (typeof pendingLayers)[string]>();
  for (const [pendingId, entry] of Object.entries(pendingLayers)) {
    const realId = layerIdFor(entry.files);
    if (!passB.groups.has(realId)) {
      warnings.push(`layer ${pendingId} (files: ${entry.files.join(", ")}) does not match any real cluster — skipped`);
      continue;
    }
    pendingByRealId.set(realId, entry);
  }

  let merged = 0;
  const skipped = Object.keys(pendingLayers).length - pendingByRealId.size;
  const layers: Layer[] = [];
  const parentOverride: [string, string][] = [];
  const layerIdByName: [string, string][] = [];
  const layerUnits: Unit[] = [];

  for (const [realId, realFiles] of passB.groups) {
    const entry = pendingByRealId.get(realId);
    const layer: Layer = entry
      ? {
          name: entry.name,
          files: realFiles,
          what: entry.what,
          how: entry.how,
          when: entry.when,
          where: entry.where,
          why: entry.why,
          confidence: entry.confidence,
          source: "manual",
        }
      : {
          name: realId,
          files: realFiles,
          what: "(no summary)",
          how: "(no summary)",
          when: "(no summary)",
          where: "(no summary)",
          why: "(no summary)",
          confidence: 0,
          source: "static",
        };
    layers.push(layer);
    layerIdByName.push([layer.name, realId]);
    for (const file of realFiles) {
      for (const unit of unitsByFile.get(file) ?? []) parentOverride.push([unit.id, realId]);
    }

    const memberUnits = realFiles.flatMap((f) => unitsByFile.get(f) ?? []);
    const memberIds = memberUnits.map((u) => u.id);
    if (memberIds.length === 0) continue;
    layerUnits.push({
      id: realId,
      kind: "layer",
      name: layer.name,
      qualname: layer.name,
      lang: undefined,
      parent: null,
      children: memberIds,
      loc: {
        files: [...new Set(memberUnits.flatMap((u) => u.loc.files))],
        start: null,
        end: null,
        sloc: memberUnits.reduce((sum, u) => sum + u.loc.sloc, 0),
      },
      semantics: { what: layer.what, how: layer.how, when: layer.when, where: layer.where, why: layer.why, confidence: layer.confidence, source: layer.source },
      cost: null,
      tags: [],
      metrics: { sloc: memberUnits.reduce((sum, u) => sum + u.loc.sloc, 0), modules: memberIds.length },
      authors: undefined,
      hash: { struct: createHash("sha1").update([...memberIds].sort().join("")).digest("hex"), text: null, semantic: null },
      provenance: entry ? { source: "manual", pass: "C" } : { source: "static" },
    });
    if (entry) merged++;
  }

  const layersData: LayersData = {
    layerUnits,
    layers,
    parentOverride,
    layerIdByName,
    repoContextText: undefined,
    clusteringVersion: CLUSTERING_VERSION,
    promptRev: ctx.promptRev,
  };

  const clustersData: ClustersData = {
    groups: [...passB.groups],
    unitsByFile: [...unitsByFile].map(([file, units]) => [file, units.map((u) => u.id)]),
    repoContextText: undefined,
    modularity: passB.modularity,
    directoryModularity: passB.directoryModularity,
    clusteringVersion: CLUSTERING_VERSION,
  };

  let docsStored = readArtifact<DocExtract[]>(ctx, "docs");
  if (!docsStored && ctx.docs.length > 0) {
    // No cached docs artifact, but discoverable doc files exist: this pending file has no doc
    // narration to offer (Phase 2 only authors layers/functions), and producing the real
    // narration would require an LLM call — the entire point of this zero-cost merge path is to
    // avoid that. Cache an empty docs artifact ourselves, under the SAME inputHash formula
    // `ensureArtifact("docs")` uses, so a later `scv analyze` sees a match and reuses it rather
    // than mismatching (which would force a layers recompute / Pass C) or silently overwriting it
    // with real narration behind our backs later on a hash that no longer matches this merge.
    // Docs narration is a known, visible gap in the zero-LLM workflow — not a silent one: warn.
    const docsInputHash = await computeInputHash("docs", ctx, {});
    writeArtifact(ctx, "docs", docsInputHash, []);
    docsStored = { inputHash: docsInputHash, data: [] };
    warnings.push("cached an empty docs artifact: doc files were discovered but no docs narration was available to merge — docs will show no summary until `scv analyze docs --force` is run with an LLM provider");
  }
  const clustersInputHash = await computeInputHash("clusters", ctx, {
    functions: { units: functionUnits, blockUnits: [], blockEdges: [] },
    docs: docsStored?.data ?? [],
  });
  writeArtifact(ctx, "clusters", clustersInputHash, clustersData);

  const layersInputHash = await computeInputHash("layers", ctx, {
    clusters: clustersData,
    functions: { units: functionUnits, blockUnits: [], blockEdges: [] },
  });
  writeArtifact(ctx, "layers", layersInputHash, layersData);

  return { merged, skipped };
}

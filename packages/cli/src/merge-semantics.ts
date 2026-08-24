import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractRepo, isGeneratedPath, isTestPath } from "@scv/extractor";
import { PendingSemanticsSchema, semanticHashInput, type Unit } from "@scv/schema";
import { runPassB, layerIdFor, CLUSTERING_VERSION, type ImportEdge, type Layer, type Provider } from "@scv/interpreter";
import { computeInputHash, type ArtifactContext } from "./artifacts.js";
import { discoverDocs } from "./discover-docs.js";
import { headRev } from "./rev.js";
import { toSnapshot } from "./snapshot.js";

interface FunctionsData {
  units: Unit[];
  blockUnits: Unit[];
  blockEdges: unknown[];
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
  scope?: string[];
  withClustering?: boolean;
}

export interface MergeSemanticsResult {
  merged: number;
  skipped: number;
  warnings: string[];
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

/** True when `id` is unrestricted (no --scope) or exactly listed in `scope`. */
function inScope(id: string, scope: string[] | undefined): boolean {
  if (!scope || scope.length === 0) return true;
  return scope.includes(id);
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

/** CLI entry point: builds an `ArtifactContext` from `root` (no provider, no LLM calls — merge
 *  is purely file-based) and runs `mergeSemantics` against it. */
export async function runMergeSemantics(options: RunMergeSemanticsOptions): Promise<MergeSemanticsResult> {
  const scvDir = options.scvDir ?? path.join(options.root, ".scv");
  const graph = extractRepo(options.root, path.join(scvDir, "artifacts", "extraction-files"));
  const rev = options.sha ? { sha: options.sha, kind: "commit" as const, ts: "", author: "", author_kind: "human" as const } : headRev(options.root);
  const snapshot = toSnapshot(graph, { root: options.root, rev });

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
  };

  return mergeSemantics({ pendingFile: options.pendingFile, ctx, scope: options.scope, withClustering: options.withClustering });
}

export async function mergeSemantics(options: MergeSemanticsOptions): Promise<MergeSemanticsResult> {
  const { pendingFile, ctx, scope, withClustering } = options;
  const warnings: string[] = [];

  const raw = JSON.parse(readFileSync(pendingFile, "utf-8"));
  const pending = PendingSemanticsSchema.parse(raw);

  const functionsStored = readArtifact<FunctionsData>(ctx, "functions");
  const functionsData: FunctionsData = functionsStored?.data ?? {
    units: ctx.graph.units.map((u) => u as unknown as Unit),
    blockUnits: [],
    blockEdges: [],
  };

  const unitById = new Map(functionsData.units.map((u) => [u.id, u]));

  let merged = 0;
  let skipped = 0;

  for (const [id, entry] of Object.entries(pending.units)) {
    if (!inScope(id, scope)) continue;

    const unit = unitById.get(id);
    if (!unit) {
      warnings.push(`unit ${id} not found in current extraction — skipped`);
      skipped++;
      continue;
    }
    if (unit.kind !== entry.kind) {
      warnings.push(`unit ${id} has kind "${unit.kind}", pending entry declares "${entry.kind}" — skipped`);
      skipped++;
      continue;
    }

    const semantics = entry.semantics
      ? { ...entry.semantics, source: "llm" as const }
      : unit.semantics;

    const mergedUnit: Unit = {
      ...unit,
      semantics: semantics ?? unit.semantics,
      cost: entry.cost ? { ...entry.cost, source: "llm" as const } : unit.cost,
      tags: entry.tags ?? unit.tags,
      signature: entry.signature ?? unit.signature,
      hash: {
        ...unit.hash,
        semantic: createHash("sha1").update(semanticHashInput(unit.name, semantics ?? null)).digest("hex"),
      },
      provenance: { source: "llm", pass: "A" },
    };

    unitById.set(id, mergedUnit);
    merged++;
  }

  functionsData.units = [...unitById.values()];

  const functionsInputHash = await computeInputHash("functions", ctx, {});
  writeArtifact(ctx, "functions", functionsInputHash, functionsData);

  if (withClustering && Object.keys(pending.layers).length > 0) {
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
  const realLayerFilesById = new Map(passB.groups);

  let merged = 0;
  let skipped = 0;
  const layers: Layer[] = [];
  const parentOverride: [string, string][] = [];
  const layerIdByName: [string, string][] = [];

  for (const [pendingId, entry] of Object.entries(pendingLayers)) {
    const realId = layerIdFor(entry.files);
    const realFiles = realLayerFilesById.get(realId);
    if (!realFiles) {
      warnings.push(`layer ${pendingId} (files: ${entry.files.join(", ")}) does not match any real cluster — skipped`);
      skipped++;
      continue;
    }

    const layer: Layer = {
      name: entry.name,
      files: realFiles,
      what: entry.what,
      how: entry.how,
      when: entry.when,
      where: entry.where,
      why: entry.why,
      confidence: entry.confidence,
      source: "llm",
    };
    layers.push(layer);
    layerIdByName.push([entry.name, realId]);
    for (const file of realFiles) {
      for (const unit of unitsByFile.get(file) ?? []) parentOverride.push([unit.id, realId]);
    }
    merged++;
  }

  const layersData: LayersData = {
    layerUnits: [],
    layers,
    parentOverride,
    layerIdByName,
    repoContextText: undefined,
    clusteringVersion: CLUSTERING_VERSION,
    promptRev: ctx.promptRev,
  };

  const layersInputHash = await computeInputHash("layers", ctx, {
    functions: { units: functionUnits, blockUnits: [], blockEdges: [] },
    docs: [],
  });
  writeArtifact(ctx, "layers", layersInputHash, layersData);

  return { merged, skipped };
}

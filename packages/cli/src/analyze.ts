import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractRepo } from "@scv/extractor";
import type { Snapshot } from "@scv/schema";
import {
  CachedProvider,
  ContentCache,
  createProvider,
  finalizeSnapshot,
  loadInterpreterConfig,
  writeInterpreterConfig,
  type InterpreterConfig,
  type Provider,
  type ProviderUsage,
} from "@scv/interpreter";
import { dependencyClosure, ensureArtifact, loadPreviousLayers, type ArtifactContext, type ArtifactName } from "./artifacts.js";
import { assembleSnapshotFromCache } from "./assemble-snapshot.js";
import { discoverDocs } from "./discover-docs.js";
import { headRev } from "./rev.js";
import { toSnapshot } from "./snapshot.js";

export interface RunAnalyzeOptions {
  root: string;
  /** Directory snapshots are written under; defaults to `<root>/.scv`. */
  scvDir?: string;
  /** Overrides the provider resolved from `<scvDir>/config.yaml`; primarily for tests. */
  provider?: Provider;
  /** Provider name to persist to `<scvDir>/config.yaml` before resolving, e.g. for first-run setup. */
  providerName?: InterpreterConfig["provider"];
  model?: string;
  effort?: InterpreterConfig["effort"];
  logLevel?: InterpreterConfig["logLevel"];
  promptRev?: string;
  /** Compute only this artifact (freshening its dependencies first) instead of the full pipeline. */
  artifact?: ArtifactName;
  /** Recompute `artifact` even if its cached inputs are unchanged; requires `artifact` to be set. */
  force?: boolean;
  /** Merge from cache only — never call a provider; artifacts with no fresh cache entry are
   *  assembled from their empty default instead of being computed. */
  noLlm?: boolean;
}

export interface RunAnalyzeResult {
  snapshot: Snapshot;
  path: string;
  usage: ProviderUsage;
  elapsedMs: number;
  /** Artifact names assembled from an empty default rather than a fresh cache entry. */
  emptyArtifacts: ArtifactName[];
}

function readSource(root: string) {
  return (file: string, start: number, end: number): string => {
    const lines = readFileSync(path.join(root, file), "utf-8").split("\n");
    return lines.slice(start - 1, end).join("\n");
  };
}

/**
 * Extracts `root`, then ensures every interpreter artifact (functions, docs, layers, groups,
 * flows) is fresh — recomputing only the artifacts whose inputs actually changed since the last
 * run for this sha, via `ensureArtifact`. Always reassembles and writes the full merged scv/1
 * Snapshot to `<scvDir>/snapshots/<sha>.json`, reflecting whatever is currently persisted for
 * every artifact.
 *
 * `noLlm` still runs this full merge/finalize path — it never calls a provider, though: every
 * artifact with no fresh cache entry is assembled from its declared empty default instead of
 * being computed (see `emptyArtifactDefault` in `artifacts.ts`).
 */
export async function runAnalyze(options: RunAnalyzeOptions): Promise<RunAnalyzeResult> {
  const scvDir = options.scvDir ?? path.join(options.root, ".scv");
  mkdirSync(scvDir, { recursive: true });

  if (options.force && !options.artifact) {
    throw new Error("--force requires a target artifact (e.g. `scv analyze --force layers`)");
  }
  if (options.force && options.noLlm) {
    throw new Error("--force contradicts --no-llm — nothing to force under a no-provider merge");
  }

  if (options.providerName || options.model || options.effort || options.logLevel) {
    const current = loadInterpreterConfig(scvDir);
    writeInterpreterConfig(scvDir, {
      provider: options.providerName ?? current.provider,
      model: options.model ?? current.model,
      effort: options.effort ?? current.effort,
      logLevel: options.logLevel ?? current.logLevel,
    });
  }

  const extractionCacheDir = path.join(scvDir, "artifacts", "extraction-files");
  const graph = extractRepo(options.root, extractionCacheDir);
  const rev = headRev(options.root);
  const structural = toSnapshot(graph, { root: options.root, rev });

  const promptRev = options.promptRev ?? "p4";
  const baseProvider = options.provider ?? createProvider(loadInterpreterConfig(scvDir));
  const cache = new ContentCache(path.join(scvDir, "cache.sqlite"));
  const provider = new CachedProvider(baseProvider, cache, promptRev);

  const runStart = performance.now();
  let snapshot: Snapshot;
  let outPath: string;
  let emptyArtifacts: ArtifactName[];
  try {
    const ctx: ArtifactContext = {
      scvDir,
      sha: rev.sha,
      snapshot: structural,
      graph,
      provider,
      promptRev,
      readSource: readSource(options.root),
      docs: discoverDocs(options.root),
      reportProgress: (phase, done, total, current) =>
        console.error(`[INFO] progress phase=${phase} ${done}/${total} current=${current ?? ""}`),
      force: options.force && options.artifact ? new Set([options.artifact]) : new Set(),
      previousLayers: loadPreviousLayers(scvDir, options.root, promptRev),
      noLlm: options.noLlm ?? false,
    };

    if (options.noLlm) {
      const assembled = await assembleSnapshotFromCache({ ctx, rev, scvDir });
      snapshot = assembled.snapshot;
      outPath = assembled.path;
      emptyArtifacts = assembled.emptyArtifacts;
    } else {
      const allowProvider = options.artifact ? dependencyClosure(options.artifact) : undefined;
      const emptyArtifactsSet = new Set<ArtifactName>();

      const target = options.artifact ?? "flows";
      const targetResult = await ensureArtifact(target, ctx, { allowProvider });
      for (const d of targetResult.defaultedArtifacts) emptyArtifactsSet.add(d);
      // Always ensure groups too when running the default full pipeline — both flows and
      // groups are leaves with nothing depending on them, so "full pipeline" means both.
      if (!options.artifact) {
        const groupsResult = await ensureArtifact("groups", ctx, { allowProvider });
        for (const d of groupsResult.defaultedArtifacts) emptyArtifactsSet.add(d);
      }

      const functionsResult = await ensureArtifact("functions", ctx, { allowProvider });
      const layersResult = await ensureArtifact("layers", ctx, { allowProvider });
      const groupsResult = await ensureArtifact("groups", ctx, { allowProvider });
      const flowsResult = await ensureArtifact("flows", ctx, { allowProvider });
      for (const r of [functionsResult, layersResult, groupsResult, flowsResult]) {
        for (const d of r.defaultedArtifacts) emptyArtifactsSet.add(d);
      }

      snapshot = finalizeSnapshot({
        snapshot: structural,
        provider,
        promptRev,
        systemName: undefined,
        units: functionsResult.data.units,
        blockUnits: functionsResult.data.blockUnits,
        blockEdges: functionsResult.data.blockEdges,
        layerUnits: layersResult.data.layerUnits,
        parentOverride: new Map(layersResult.data.parentOverride),
        groupUnits: groupsResult.data.groupUnits,
        layerParent: new Map(groupsResult.data.layerParent),
        flowUnits: flowsResult.data,
      });

      const snapshotsDir = path.join(scvDir, "snapshots");
      mkdirSync(snapshotsDir, { recursive: true });
      outPath = path.join(snapshotsDir, `${rev.sha}.json`);
      writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
      emptyArtifacts = [...emptyArtifactsSet];
    }
  } finally {
    cache.close();
  }
  const elapsedMs = Math.round(performance.now() - runStart);
  const usage = provider.usage;

  return { snapshot, path: outPath, usage, elapsedMs, emptyArtifacts };
}

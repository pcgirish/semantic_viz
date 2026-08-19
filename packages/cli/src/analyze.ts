import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractRepo } from "@scv/extractor";
import type { Snapshot, Unit } from "@scv/schema";
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
import { ensureArtifact, type ArtifactContext, type ArtifactName } from "./artifacts.js";
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
  /** Stop after extraction — no LLM passes run, snapshot contains only static units/edges. */
  noLlm?: boolean;
}

export interface RunAnalyzeResult {
  snapshot: Snapshot;
  path: string;
  usage: ProviderUsage;
  elapsedMs: number;
}

function readSource(root: string) {
  return (file: string, start: number, end: number): string => {
    const lines = readFileSync(path.join(root, file), "utf-8").split("\n");
    return lines.slice(start - 1, end).join("\n");
  };
}

/**
 * Extracts `root` and, unless `noLlm` is set, ensures every interpreter artifact (functions,
 * docs, layers, groups, flows) is fresh — recomputing only the artifacts whose inputs actually
 * changed since the last run for this sha, via `ensureArtifact`. Always reassembles and writes
 * the full merged scv/1 Snapshot to `<scvDir>/snapshots/<sha>.json`, reflecting whatever is
 * currently persisted for every artifact.
 */
export async function runAnalyze(options: RunAnalyzeOptions): Promise<RunAnalyzeResult> {
  const scvDir = options.scvDir ?? path.join(options.root, ".scv");
  mkdirSync(scvDir, { recursive: true });

  if (options.force && !options.artifact) {
    throw new Error("--force requires a target artifact (e.g. `scv analyze --force layers`)");
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
  try {
    if (options.noLlm) {
      snapshot = structural;
    } else {
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
      };

      const target = options.artifact ?? "flows";
      await ensureArtifact(target, ctx);
      // Always ensure groups too when running the default full pipeline — both flows and
      // groups are leaves with nothing depending on them, so "full pipeline" means both.
      if (!options.artifact) await ensureArtifact("groups", ctx);

      const functions = await ensureArtifact("functions", ctx);
      const layers = await ensureArtifact("layers", ctx);
      const groups = await ensureArtifact("groups", ctx);
      const flows = await ensureArtifact("flows", ctx);

      const layerUnitsByName = new Map(groups.map((u) => [u.name, u]));
      const groupedLayerUnits: Unit[] = layers.layerUnits.map((l) => layerUnitsByName.get(l.name) ?? l);

      snapshot = finalizeSnapshot({
        snapshot: structural,
        provider,
        promptRev,
        systemName: undefined,
        units: functions.units,
        blockUnits: functions.blockUnits,
        blockEdges: functions.blockEdges,
        layerUnits: groupedLayerUnits,
        parentOverride: new Map(layers.parentOverride),
        flowUnits: flows,
      });
    }
  } finally {
    cache.close();
  }
  const elapsedMs = Math.round(performance.now() - runStart);
  const usage = provider.usage;

  const snapshotsDir = path.join(scvDir, "snapshots");
  mkdirSync(snapshotsDir, { recursive: true });
  const outPath = path.join(snapshotsDir, `${rev.sha}.json`);
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

  return { snapshot, path: outPath, usage, elapsedMs };
}

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractRepo } from "@semviz/extractor";
import type { Snapshot, Unit } from "@semviz/schema";
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
} from "@semviz/interpreter";
import { dependencyClosure, ensureArtifact, loadPreviousLayers, type ArtifactContext, type ArtifactName } from "./artifacts.js";
import { assembleSnapshotFromCache } from "./assemble-snapshot.js";
import { discoverDocs } from "./discover-docs.js";
import { inScope, resolveChangedFiles } from "./merge-semantics.js";
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
  /**
   * Never call a provider. Without `artifact`, merge from cache only: artifacts with no fresh
   * cache entry are assembled from their empty default instead of being computed. With `artifact`,
   * that artifact is still ensured — so a deterministic target (`clusters`, `extraction`) really
   * is computed while provider-backed artifacts empty-default — and a defaulted dependency throws
   * `DefaultedArtifactsError` rather than warning.
   */
  noLlm?: boolean;
  /** Restrict Pass A to matching units — `all`, `changed`, or globs over dotted unit ids
   *  (e.g. `u:src.handlers.**`). Lets a large repo be analyzed in slices. */
  scope?: string[];
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
 * `noLlm` still runs this full merge/finalize path, and never calls a provider. Without a target
 * artifact, every artifact with no fresh cache entry is assembled from its declared empty default
 * instead of being computed (see `emptyArtifactDefault` in `artifacts.ts`). With one, that target
 * is ensured under an empty `allowProvider`, so a deterministic stage is genuinely computed while
 * provider-backed stages still empty-default — and computing it over defaulted dependencies is
 * refused with `DefaultedArtifactsError` rather than silently producing a poor result.
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

  // Pass A resume: reload every unit already completed for this exact source, and persist each
  // new one the moment it resolves, so an interrupt costs at most the units still in flight.
  // A unit with no structural hash cannot be invalidated by its own source changing, so it is
  // left out of the store entirely rather than keyed on a placeholder.
  const structHashByUnitId = new Map(
    structural.units.flatMap((u) => (u.hash.struct ? [[u.id, u.hash.struct] as [string, string]] : [])),
  );
  const passAUnitsKey = { sha: rev.sha, promptRev, provider: baseProvider.name, model: baseProvider.model };
  const passAStore = {
    prior: cache.getPassAUnits(passAUnitsKey, structHashByUnitId),
    record: (id: string, unit: Unit, status: "ok" | "failed"): void => {
      const structHash = structHashByUnitId.get(id);
      if (!structHash) return;
      cache.setPassAUnit(passAUnitsKey, { unitId: id, structHash, unit, status });
    },
  };

  const scopeIsAll = !options.scope || options.scope.length === 0 || options.scope.includes("all");
  // Resolved once for the whole snapshot — `inScope` runs per unit, so a git call inside it
  // would cost one subprocess per unit. Skipped entirely unless `changed` is actually asked for.
  const changed = !scopeIsAll && options.scope!.includes("changed") ? resolveChangedFiles(options.root) : new Set<string>();
  const scopedLeafIds = scopeIsAll
    ? undefined
    : new Set(structural.units.filter((u) => inScope(u, options.scope, changed)).map((u) => u.id));

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
      scopedLeafIds,
      scopeKey: scopeIsAll ? "all" : [...options.scope!].sort().join(","),
      passAStore,
    };

    if (options.noLlm && !options.artifact) {
      const assembled = await assembleSnapshotFromCache({ ctx, rev, scvDir });
      snapshot = assembled.snapshot;
      outPath = assembled.path;
      emptyArtifacts = assembled.emptyArtifacts;
    } else {
      // Under `--no-llm` the allow-list is empty, full stop. It is an allow-list, so passing the
      // dependency closure would *permit* exactly the provider calls the flag exists to block; a
      // deterministic target still computes because it is exempt from the gate, not because it is
      // named in the set.
      const allowProvider = options.noLlm
        ? new Set<ArtifactName>()
        : options.artifact
          ? dependencyClosure(options.artifact)
          : undefined;
      const emptyArtifactsSet = new Set<ArtifactName>();

      const target = options.artifact ?? "flows";
      const targetResult = await ensureArtifact(target, ctx, {
        allowProvider,
        // Refuse to compute a deterministic target over empty defaults: the result would be
        // cache-fresh, indistinguishable from a good one, and silently reused.
        requireFreshDependencies: options.noLlm === true,
      });
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

      // A `functions` artifact written by `merge-semantics --sha` carries its block units inside
      // `units` as well as in `blockUnits`; `finalizeSnapshot` appends `blockUnits` itself and
      // rejects the double-carry. Mirrors `assembleSnapshotFromCache`.
      const blockIds = new Set(functionsResult.data.blockUnits.map((u) => u.id));
      const functionUnits =
        blockIds.size > 0 ? functionsResult.data.units.filter((u) => !blockIds.has(u.id)) : functionsResult.data.units;

      snapshot = finalizeSnapshot({
        snapshot: structural,
        provider,
        promptRev,
        systemName: undefined,
        units: functionUnits,
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

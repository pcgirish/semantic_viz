import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractRepo } from "@scv/extractor";
import type { Snapshot } from "@scv/schema";
import {
  CachedProvider,
  ContentCache,
  createProvider,
  loadInterpreterConfig,
  runInterpreter,
  writeInterpreterConfig,
  type InterpreterConfig,
  type Provider,
} from "@scv/interpreter";
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
}

export interface RunAnalyzeResult {
  snapshot: Snapshot;
  path: string;
}

function readSource(root: string) {
  return (file: string, start: number, end: number): string => {
    const lines = readFileSync(path.join(root, file), "utf-8").split("\n");
    return lines.slice(start - 1, end).join("\n");
  };
}

/** Extracts `root`, runs the Interpreter (Pass A/B/C) to lift semantics, clustering, and layer narration, and writes the resulting scv/1 Snapshot to `<scvDir>/snapshots/<sha>.json`. Interpreter calls are content-cached at `<scvDir>/cache.sqlite` so re-analyzing unchanged units never re-invokes the LLM and never introduces spurious semantic drift from model non-determinism. */
export async function runAnalyze(options: RunAnalyzeOptions): Promise<RunAnalyzeResult> {
  const scvDir = options.scvDir ?? path.join(options.root, ".scv");
  mkdirSync(scvDir, { recursive: true });

  if (options.providerName || options.model || options.effort || options.logLevel) {
    const current = loadInterpreterConfig(scvDir);
    writeInterpreterConfig(scvDir, {
      provider: options.providerName ?? current.provider,
      model: options.model ?? current.model,
      effort: options.effort ?? current.effort,
      logLevel: options.logLevel ?? current.logLevel,
    });
  }

  const graph = extractRepo(options.root);
  const rev = headRev(options.root);
  const structural = toSnapshot(graph, { root: options.root, rev });

  const promptRev = options.promptRev ?? "p1";
  const baseProvider = options.provider ?? createProvider(loadInterpreterConfig(scvDir));
  const cache = new ContentCache(path.join(scvDir, "cache.sqlite"));
  const provider = new CachedProvider(baseProvider, cache, promptRev);

  let snapshot: Snapshot;
  try {
    snapshot = await runInterpreter({
      snapshot: structural,
      graph,
      provider,
      promptRev,
      readSource: readSource(options.root),
    });
  } finally {
    cache.close();
  }

  const snapshotsDir = path.join(scvDir, "snapshots");
  mkdirSync(snapshotsDir, { recursive: true });
  const outPath = path.join(snapshotsDir, `${rev.sha}.json`);
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

  return { snapshot, path: outPath };
}

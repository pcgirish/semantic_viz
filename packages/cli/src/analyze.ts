import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractRepo } from "@scv/extractor";
import type { Snapshot } from "@scv/schema";
import { createProvider, loadInterpreterConfig, runInterpreter, type Provider } from "@scv/interpreter";
import { headRev } from "./rev.js";
import { toSnapshot } from "./snapshot.js";

export interface RunAnalyzeOptions {
  root: string;
  /** Directory snapshots are written under; defaults to `<root>/.scv`. */
  scvDir?: string;
  /** Overrides the provider resolved from `<scvDir>/config.yaml`; primarily for tests. */
  provider?: Provider;
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

/** Extracts `root`, runs the Interpreter (Pass A/B/C) to lift semantics, clustering, and layer narration, and writes the resulting scv/1 Snapshot to `<scvDir>/snapshots/<sha>.json`. */
export async function runAnalyze(options: RunAnalyzeOptions): Promise<RunAnalyzeResult> {
  const scvDir = options.scvDir ?? path.join(options.root, ".scv");
  const graph = extractRepo(options.root);
  const rev = headRev(options.root);
  const structural = toSnapshot(graph, { root: options.root, rev });

  const provider = options.provider ?? createProvider(loadInterpreterConfig(scvDir));
  const snapshot = await runInterpreter({
    snapshot: structural,
    graph,
    provider,
    promptRev: options.promptRev ?? "p1",
    readSource: readSource(options.root),
  });

  const snapshotsDir = path.join(scvDir, "snapshots");
  mkdirSync(snapshotsDir, { recursive: true });
  const outPath = path.join(snapshotsDir, `${rev.sha}.json`);
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

  return { snapshot, path: outPath };
}

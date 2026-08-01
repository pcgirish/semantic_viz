import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractRepo } from "@scv/extractor";
import type { Snapshot } from "@scv/schema";
import { headRev } from "./rev.js";
import { toSnapshot } from "./snapshot.js";

export interface RunAnalyzeOptions {
  root: string;
  /** Directory snapshots are written under; defaults to `<root>/.scv`. */
  scvDir?: string;
}

export interface RunAnalyzeResult {
  snapshot: Snapshot;
  path: string;
}

/** Extracts `root`, maps to a scv/1 Snapshot (semantics not yet lifted), and writes it to `<scvDir>/snapshots/<sha>.json`. */
export async function runAnalyze(options: RunAnalyzeOptions): Promise<RunAnalyzeResult> {
  const scvDir = options.scvDir ?? path.join(options.root, ".scv");
  const graph = extractRepo(options.root);
  const rev = headRev(options.root);
  const snapshot = toSnapshot(graph, { root: options.root, rev });

  const snapshotsDir = path.join(scvDir, "snapshots");
  mkdirSync(snapshotsDir, { recursive: true });
  const outPath = path.join(snapshotsDir, `${rev.sha}.json`);
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

  return { snapshot, path: outPath };
}

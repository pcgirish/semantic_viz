import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runDifferWithRisk } from "@scv/differ";
import { createProvider, loadInterpreterConfig, type Provider } from "@scv/interpreter";
import type { Delta, Snapshot } from "@scv/schema";

export interface RunDiffOptions {
  scvDir: string;
  from: string;
  to: string;
  provider?: Provider;
  promptRev?: string;
}

export interface RunDiffResult {
  delta: Delta;
  path: string;
}

function readSnapshot(scvDir: string, sha: string): Snapshot {
  const snapshotPath = path.join(scvDir, "snapshots", `${sha}.json`);
  if (!existsSync(snapshotPath)) {
    throw new Error(`no snapshot found for rev "${sha}" at ${snapshotPath} — run scv analyze at that rev first`);
  }
  return JSON.parse(readFileSync(snapshotPath, "utf-8")) as Snapshot;
}

/** Reads two previously written snapshots by sha and writes their Differ output (with Pass D risk narration and ranking) to `<scvDir>/deltas/<from>__<to>.json`. */
export async function runDiff(options: RunDiffOptions): Promise<RunDiffResult> {
  const { scvDir, from, to } = options;
  const a = readSnapshot(scvDir, from);
  const b = readSnapshot(scvDir, to);

  const provider = options.provider ?? createProvider(loadInterpreterConfig(scvDir));
  const delta = await runDifferWithRisk(a, b, provider, options.promptRev ?? "p1");

  const deltasDir = path.join(scvDir, "deltas");
  mkdirSync(deltasDir, { recursive: true });
  const outPath = path.join(deltasDir, `${from}__${to}.json`);
  writeFileSync(outPath, JSON.stringify(delta, null, 2));

  return { delta, path: outPath };
}

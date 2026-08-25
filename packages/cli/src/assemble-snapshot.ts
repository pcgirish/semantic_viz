import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Snapshot } from "@scv/schema";
import { finalizeSnapshot } from "@scv/interpreter";
import { ensureArtifact, type ArtifactContext, type ArtifactName } from "./artifacts.js";

export interface AssembleSnapshotOptions {
  ctx: ArtifactContext;
  rev: Snapshot["rev"];
  scvDir: string;
}

export interface AssembleSnapshotResult {
  snapshot: Snapshot;
  path: string;
  emptyArtifacts: ArtifactName[];
}

/**
 * Assembles a snapshot purely from whatever's cached, calling no provider: `functions`, `layers`,
 * `groups`, and `flows` are each fetched with `allowProvider: new Set()`, so any without a fresh
 * cache entry come back as `emptyArtifactDefault`s instead of triggering real computation. Used by
 * both `runAnalyze`'s `--no-llm` path and `runMergeSemantics` (after merging pending semantics),
 * so a snapshot always gets written after either, without duplicating this assembly logic.
 */
export async function assembleSnapshotFromCache(options: AssembleSnapshotOptions): Promise<AssembleSnapshotResult> {
  const { ctx, rev, scvDir } = options;
  const allowProvider = new Set<ArtifactName>();

  const emptyArtifacts = new Set<ArtifactName>();
  const functionsResult = await ensureArtifact("functions", ctx, { allowProvider });
  const layersResult = await ensureArtifact("layers", ctx, { allowProvider });
  const groupsResult = await ensureArtifact("groups", ctx, { allowProvider });
  const flowsResult = await ensureArtifact("flows", ctx, { allowProvider });
  for (const r of [functionsResult, layersResult, groupsResult, flowsResult]) {
    for (const d of r.defaultedArtifacts) emptyArtifacts.add(d);
  }

  const snapshot = finalizeSnapshot({
    snapshot: ctx.snapshot,
    provider: ctx.provider,
    promptRev: ctx.promptRev,
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
  const outPath = path.join(snapshotsDir, `${rev.sha}.json`);
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

  return { snapshot, path: outPath, emptyArtifacts: [...emptyArtifacts] };
}

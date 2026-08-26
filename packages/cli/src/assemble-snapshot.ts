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

  // A `functions` artifact written by `merge-semantics --sha` carries its block units inside
  // `units` as well as in `blockUnits`. `finalizeSnapshot` appends `blockUnits` itself and
  // rejects the double-carry, so the duplicates are stripped from `units` here and re-supplied
  // through the one channel that owns them. When `blockUnits` is empty there is nothing to
  // re-supply, so blocks living only in `units` are left where they are.
  const blockIds = new Set(functionsResult.data.blockUnits.map((u) => u.id));
  const functionUnits =
    blockIds.size > 0 ? functionsResult.data.units.filter((u) => !blockIds.has(u.id)) : functionsResult.data.units;

  const snapshot = finalizeSnapshot({
    snapshot: ctx.snapshot,
    provider: ctx.provider,
    promptRev: ctx.promptRev,
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
  const outPath = path.join(snapshotsDir, `${rev.sha}.json`);
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

  return { snapshot, path: outPath, emptyArtifacts: [...emptyArtifacts] };
}

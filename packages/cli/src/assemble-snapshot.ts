import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Snapshot } from "@semviz/schema";
import { finalizeSnapshot } from "@semviz/interpreter";
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

  // `finalizeSnapshot` owns exactly one channel for blocks: it appends `blockUnits`/`blockEdges`
  // to whatever the base snapshot holds. Two sources can already carry those same blocks:
  //   - a `functions` artifact written by `merge-semantics --sha`, which repeats its block units
  //     inside `units`; and
  //   - a historical base snapshot re-read from `.scv/snapshots/<sha>.json`, which persists both
  //     the block units and their `control_flow` edges.
  // Either one passed through unstripped duplicates every block (silently, for edges — the
  // double-carry guard in `finalizeSnapshot` only inspects units). So strip the persisted copies
  // here and re-supply them through the channel that owns them.
  //
  // The strip is unconditional, keyed on `kind`/`kind === "control_flow"` rather than on the ids
  // in `blockUnits`. Keying off those ids made it a no-op exactly when `blockUnits` was empty —
  // which is the historical case where the base snapshot is the *only* block carrier, so the
  // blocks stayed in `units` and violated the single-owner invariant instead of being restored
  // through it. `mergeSemantics` now partitions persisted blocks into `blockUnits`/`blockEdges`
  // up front, and this strip holds regardless of which path produced them.
  const functionUnits = functionsResult.data.units.filter((u) => u.kind !== "block");
  const snapshotForAssembly = {
    ...ctx.snapshot,
    units: ctx.snapshot.units.filter((u) => u.kind !== "block"),
    edges: ctx.snapshot.edges.filter((e) => e.kind !== "control_flow"),
  };

  const snapshot = finalizeSnapshot({
    snapshot: snapshotForAssembly,
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

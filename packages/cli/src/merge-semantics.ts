import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { extractRepo, type SymbolGraph } from "@scv/extractor";
import {
  PendingSemanticsSchema,
  SnapshotSchema,
  semanticHashInput,
  type Edge,
  type PendingBlockLabel,
  type PendingDoc,
  type PendingFlow,
  type PendingGroup,
  type PendingLayer,
  type PendingSemantics,
  type Snapshot,
  type Unit,
} from "@scv/schema";
import {
  layerIdFor,
  buildGroupUnits,
  buildBlockUnits,
  buildFlowTracingContext,
  buildFlowUnit,
  recoverBlockLabels,
  traceFlowSteps,
  systemIdFor,
  UNGROUPED_ID,
  CLUSTERING_VERSION,
  type BlockLabelWithProvenance,
  type DocExtract,
  type Layer,
  type Provider,
} from "@scv/interpreter";
import { computeInputHash, ensureArtifact, readArtifact, writeArtifact, type ArtifactContext, type ArtifactName } from "./artifacts.js";
import { assembleSnapshotFromCache } from "./assemble-snapshot.js";
import { readAuthoredRecord, stampAuthored, writeAuthoredRecord } from "./authored-record.js";
import { discoverDocs } from "./discover-docs.js";
import { authoredFromStore, computeClusters, emptyAuthoredSet } from "./fingerprints.js";
import { changedFiles, headRev } from "./rev.js";
import { STORE_REL_DIR, readStoreFromDisk, type StoreContents } from "./semantics-store.js";
import { toSnapshot } from "./snapshot.js";

interface FunctionsData {
  units: Unit[];
  blockUnits: Unit[];
  blockEdges: Edge[];
}

interface ClustersData {
  groups: [string, string[]][];
  unitsByFile: [string, string[]][];
  repoContextText: string | undefined;
  modularity: number;
  directoryModularity: number;
  clusteringVersion: string;
}

interface LayersData {
  layerUnits: Unit[];
  layers: Layer[];
  parentOverride: [string, string][];
  layerIdByName: [string, string][];
  repoContextText: string | undefined;
  clusteringVersion: string;
  promptRev: string;
}

export interface MergeSemanticsOptions {
  /** Exactly one of `pendingFile` / `pending` is given; `pending` is how `scv hydrate` merges
   *  committed entries without staging a file. */
  pendingFile?: string;
  pending?: PendingSemantics;
  ctx: ArtifactContext;
  /** Filesystem repo root, used by `--scope changed` to run `git diff` against. `ctx.snapshot.repo.root`
   *  is a display name (`path.basename`), not a usable path, so this must be passed separately. */
  root: string;
  scope?: string[];
  withClustering?: boolean;
  withGroups?: boolean;
  withFlows?: boolean;
  withDocs?: boolean;
  /** True when `ctx.graph` was rebuilt by `graphFromSnapshot` rather than a live `extractRepo`
   *  call. Such a graph has no `via: "di"` edges and an empty `blockGraph`, so flow merging must
   *  refuse rather than emit a silently degraded flow. */
  fromPersistedSnapshot?: boolean;
  /** The committed store merged entries are stamped against. Defaults to the working tree's
   *  `.scv/semantics/` under `root`; hydrate passes the store read at the hydrated rev. */
  committedStore?: StoreContents;
}

export interface MergeSemanticsResult {
  merged: number;
  skipped: number;
  warnings: string[];
}

export interface RunMergeSemanticsResult extends MergeSemanticsResult {
  snapshot: Snapshot;
  path: string;
  emptyArtifacts: ArtifactName[];
}

/** Converts a `--scope` glob (`*` = one path segment, `**` = any depth) to a matcher against
 *  dotted unit ids/qualnames (e.g. `u:src.handlers.create_order`), where `.` is the segment
 *  separator. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped
    .replace(/\*\*/g, " ")
    .replace(/\*/g, "[^.]*")
    .replace(/ /g, ".*");
  return new RegExp(`^${pattern}$`);
}

/** The changed-file set `--scope changed` matches against, resolved once per invocation.
 *  Callers pass this to `inScope` rather than letting it shell out per unit. */
export function resolveChangedFiles(root: string): Set<string> {
  return new Set(changedFiles(root));
}

/**
 * `--scope` semantics per the plan: `all` (or omitted) matches every entry; `changed` matches
 * units whose file appears in `git diff --name-only HEAD~1 HEAD`; anything else is a glob
 * matched against the unit id.
 *
 * `changed` is a `Set` resolved once by the caller (`resolveChangedFiles`), not fetched here —
 * this predicate runs once per structural unit, and shelling out to git inside it would spawn
 * one subprocess per unit on exactly the large repos scoped analysis exists to serve.
 */
export function inScope(
  unit: { id: string; loc: { files: string[] } },
  scope: string[] | undefined,
  changed: ReadonlySet<string>,
): boolean {
  if (!scope || scope.length === 0 || scope.includes("all")) return true;

  return scope.some((pattern) => {
    if (pattern === "changed") return unit.loc.files.some((f) => changed.has(f));
    return globToRegExp(pattern).test(unit.id);
  });
}

export interface RunMergeSemanticsOptions {
  root: string;
  pendingFile: string;
  scvDir?: string;
  scope?: string[];
  withClustering?: boolean;
  withGroups?: boolean;
  withFlows?: boolean;
  withDocs?: boolean;
  sha?: string;
}

const noopProvider: Provider = {
  name: "none",
  model: "none",
  interpret: () => {
    throw new Error("merge-semantics must never call the provider");
  },
};

/** The artifact context for a merge that must never reach a provider (`merge-semantics`, `hydrate`). */
export function noLlmContext(fields: Pick<ArtifactContext, "scvDir" | "sha" | "snapshot" | "graph" | "docs">): ArtifactContext {
  return {
    ...fields,
    provider: noopProvider,
    promptRev: "p4",
    readSource: () => "",
    reportProgress: () => {},
    force: new Set(),
    noLlm: true,
  };
}

const STRUCTURAL_KINDS = new Set(["module", "class", "function"]);
const STRUCTURAL_EDGE_KINDS = new Set(["imports", "calls", "inherits"]);

/** Rebuilds a `SymbolGraph`-shaped object from a persisted structural snapshot's units/edges.
 *  Exact for hashing: `toUnit`/`toEdge` (in snapshot.ts) copy `hash.struct`/`hash.text`/`from`/
 *  `to`/`kind` verbatim from the original `SymbolGraph`, so `graphHash` over this reconstruction
 *  matches what it was when the snapshot was written — the other `SymbolUnit`/`SymbolEdge`
 *  fields (`params`, `returns`, `bases`, `metrics`, `authors`, `evidence`, `confidence`) are
 *  never read by anything `merge-semantics` calls (no pass runs; only `graphHash` inspects
 *  `graph`). Non-structural units (layer/group/api_flow/block/etc., only present in a
 *  post-LLM snapshot) are dropped — raw extraction never emits those kinds either. */
function graphFromSnapshot(snapshot: Snapshot): SymbolGraph {
  const structuralUnits = snapshot.units.filter(
    (u): u is Unit & { kind: "module" | "class" | "function" } => STRUCTURAL_KINDS.has(u.kind),
  );
  return {
    units: structuralUnits.map((u) => ({
      id: u.id,
      kind: u.kind,
      name: u.name,
      qualname: u.qualname,
      lang: u.lang ?? "",
      parent: u.parent,
      children: u.children,
      loc: { file: u.loc.files[0] ?? "", start: u.loc.start ?? 0, end: u.loc.end ?? 0 },
      sloc: u.loc.sloc,
      params: [],
      returns: null,
      bases: [],
      hash: { struct: u.hash.struct ?? "", text: u.hash.text ?? "" },
      metrics: { fanIn: u.metrics.fan_in ?? 0, fanOut: u.metrics.fan_out ?? 0, churn: u.metrics.churn ?? 0, commits: u.metrics.commits ?? 0 },
      authors: u.authors ?? [],
    })),
    edges: snapshot.edges
      .filter((e): e is Edge & { kind: "imports" | "calls" | "inherits" } => STRUCTURAL_EDGE_KINDS.has(e.kind))
      .map((e) => ({
        id: e.id,
        from: e.from,
        to: e.to,
        kind: e.kind,
        confidence: e.confidence,
        evidence: e.evidence?.[0] ?? { file: "", line: 0 },
      })),
    externals: [],
    blockGraph: {},
    routes: [],
  };
}

function loadPersistedSnapshot(scvDir: string, sha: string): Snapshot | undefined {
  const file = path.join(scvDir, "snapshots", `${sha}.json`);
  if (!existsSync(file)) return undefined;
  try {
    return SnapshotSchema.parse(JSON.parse(readFileSync(file, "utf-8")));
  } catch {
    return undefined;
  }
}

/** CLI entry point: builds an `ArtifactContext` from `root` (no provider, no LLM calls — merge
 *  is purely file-based) and runs `mergeSemantics` against it. When `--sha` names a commit with
 *  a persisted `.scv/snapshots/<sha>.json` (e.g. from a prior `--no-llm` run), merges against
 *  that structural snapshot instead of the current worktree — extraction has no historical-sha
 *  capability, so this is the only way to merge against a non-HEAD revision. Falls back to live
 *  extraction of the current worktree when no such snapshot exists, and without `--sha` always
 *  extracts live, ignoring any snapshot a previous run left at HEAD's sha. */
export async function runMergeSemantics(options: RunMergeSemanticsOptions): Promise<RunMergeSemanticsResult> {
  const scvDir = options.scvDir ?? path.join(options.root, ".scv");
  const rev = options.sha ? { sha: options.sha, kind: "commit" as const, ts: "", author: "", author_kind: "human" as const } : headRev(options.root);

  // Only for an explicit `--sha`. At HEAD the worktree is authoritative and a snapshot file is
  // just a leftover from a prior run — reloading it would rebuild the graph via
  // `graphFromSnapshot`, whose `extraction` input hash differs from the live one, marking every
  // artifact below it stale and breaking follow-up `--with-groups` / `--with-flows` merges.
  const persisted = options.sha ? loadPersistedSnapshot(scvDir, rev.sha) : undefined;
  const graph = persisted ? graphFromSnapshot(persisted) : extractRepo(options.root, path.join(scvDir, "artifacts", "extraction-files"));
  const snapshot = persisted ?? toSnapshot(graph, { root: options.root, rev });

  const ctx = noLlmContext({ scvDir, sha: rev.sha, snapshot, graph, docs: discoverDocs(options.root) });

  const mergeResult = await mergeSemantics({
    pendingFile: options.pendingFile,
    ctx,
    root: options.root,
    scope: options.scope,
    withClustering: options.withClustering,
    withGroups: options.withGroups,
    withDocs: options.withDocs,
    withFlows: options.withFlows,
    fromPersistedSnapshot: persisted !== undefined,
  });
  const assembled = await assembleSnapshotFromCache({ ctx, rev, scvDir });

  return { ...mergeResult, snapshot: assembled.snapshot, path: assembled.path, emptyArtifacts: assembled.emptyArtifacts };
}

export async function mergeSemantics(options: MergeSemanticsOptions): Promise<MergeSemanticsResult> {
  const { ctx, root, scope, withClustering, withGroups, withFlows, withDocs, fromPersistedSnapshot } = options;
  const warnings: string[] = [];

  const pending = options.pending ?? readPendingFile(options.pendingFile);
  const now = emptyAuthoredSet();

  const functionsStored = readArtifact<FunctionsData>(ctx, "functions");

  /**
   * Enforces the single-owner invariant on the way in: block units live in `blockUnits` and their
   * control-flow edges in `blockEdges` — never inline in `units`. Downstream, assembly strips
   * every `kind === "block"` unit from the base and re-supplies blocks solely through those two
   * collections, so anything left inline is silently dropped.
   *
   * Two inputs can violate it. A *persisted* snapshot carries blocks inline in `units` with their
   * edges in `snapshot.edges`. And a `functions.json` written by an older build can hold blocks
   * inline in `data.units` with both collections empty — which is why this normalizes the cached
   * artifact too, not just the snapshot fallback.
   */
  const partitionBlocks = (units: Unit[], blockUnits: Unit[], blockEdges: Edge[], edgeSource: Edge[]): FunctionsData => {
    const inline = units.filter((u) => u.kind === "block");
    if (inline.length === 0) return { units, blockUnits, blockEdges };
    const known = new Set(blockUnits.map((u) => u.id));
    const recoveredEdges =
      blockEdges.length > 0 ? blockEdges : edgeSource.filter((e) => e.kind === "control_flow");
    return {
      units: units.filter((u) => u.kind !== "block"),
      blockUnits: [...blockUnits, ...inline.filter((u) => !known.has(u.id))],
      blockEdges: recoveredEdges,
    };
  };

  const functionsData: FunctionsData = functionsStored
    ? partitionBlocks(functionsStored.data.units, functionsStored.data.blockUnits, functionsStored.data.blockEdges, ctx.snapshot.edges)
    : partitionBlocks(ctx.snapshot.units, [], [], ctx.snapshot.edges);

  // Block units are pure AST structure, so they cost nothing to rebuild here and must not be
  // left empty — without them the Flowchart view is silently blank on every agent-authored
  // path. Labels already earned by a cached artifact are recovered and carried through, so a
  // semantics-only merge never resets a labeled block to its structural fallback.
  const recoveredLabels = recoverBlockLabels(functionsData.blockUnits, functionsData.blockEdges);
  const blockLabelResult = mergeBlockLabels(ctx, pending.units, recoveredLabels, warnings);

  const unitById = new Map(functionsData.units.map((u) => [u.id, u]));

  let merged = blockLabelResult.merged;
  let skipped = blockLabelResult.skipped;

  // Resolved once, not per unit — see `inScope`.
  const changed = scope?.includes("changed") ? resolveChangedFiles(root) : new Set<string>();

  for (const [id, entry] of Object.entries(pending.units)) {
    const unit = unitById.get(id);
    if (!unit) {
      warnings.push(`unit ${id} not found in current extraction — skipped`);
      skipped++;
      continue;
    }
    if (!inScope(unit, scope, changed)) continue;
    if (unit.kind !== entry.kind) {
      warnings.push(`unit ${id} has kind "${unit.kind}", pending entry declares "${entry.kind}" — skipped`);
      skipped++;
      continue;
    }

    const semantics = entry.semantics
      ? { ...entry.semantics, source: "manual" as const }
      : unit.semantics;

    const mergedUnit: Unit = {
      ...unit,
      semantics: semantics ?? unit.semantics,
      cost: entry.cost ? { ...entry.cost, source: "manual" as const } : unit.cost,
      tags: entry.tags ?? unit.tags,
      signature: entry.signature ?? unit.signature,
      hash: {
        ...unit.hash,
        semantic: createHash("sha1").update(semanticHashInput(unit.name, semantics ?? null)).digest("hex"),
      },
      provenance: { source: "manual", pass: "A" },
    };

    unitById.set(id, mergedUnit);
    now.functions[id] = { entry };
    merged++;
  }

  // A persisted snapshot has no blockGraph to walk (`graphFromSnapshot` hardcodes it empty), so
  // any block units it already carries are left exactly as they are rather than rebuilt.
  if (fromPersistedSnapshot) {
    functionsData.units = [...unitById.values()];
    if (blockLabelResult.merged > 0) {
      warnings.push(`merging from a persisted snapshot: ${blockLabelResult.merged} authored block label(s) ignored — there is no block graph to rebuild against`);
    }
    if (functionsData.blockUnits.length > 0) {
      warnings.push("merging from a persisted snapshot: existing block units are carried through unchanged and block labels cannot be updated");
    }
  } else {
    // `blockUnits` is the only channel for block data — the base `units` array must never also
    // carry it, or a re-merge double-counts. A cached artifact's units already hold block ids in
    // their `children` and (historically) block units inline, so strip both back to a clean base
    // before rebuilding. On a first merge these filters are no-ops.
    const blockIds = new Set(functionsData.blockUnits.map((u) => u.id));
    const base = [...unitById.values()]
      .filter((u) => u.kind !== "block")
      .map((u) => (u.children.some((c) => blockIds.has(c)) ? { ...u, children: u.children.filter((c) => !blockIds.has(c)) } : u));

    const built = buildBlockUnits(base, ctx.graph, blockLabelResult.labels);
    functionsData.units = built.unitsWithBlockChildren;
    functionsData.blockUnits = built.blockUnits;
    functionsData.blockEdges = built.blockEdges;
  }

  const functionsInputHash = await computeInputHash("functions", ctx, {});
  writeArtifact(ctx, "functions", functionsInputHash, functionsData);

  // Before clustering, not after: Pass B consumes the `docs` artifact, so docs authored in the
  // same pending file must already be on disk when `mergeLayerClustering` reads them.
  if (withDocs) {
    const docsResult = await mergeDocs(ctx, pending.docs, warnings);
    merged += docsResult.merged;
    skipped += docsResult.skipped;
    for (const doc of docsResult.authored) now.docs[doc.path] = { entry: doc };
  }

  if (withClustering) {
    const clusterResult = await mergeLayerClustering(ctx, pending.layers, functionsData.units, warnings);
    merged += clusterResult.merged;
    skipped += clusterResult.skipped;
    if (clusterResult.merged > 0) now.layers = { entry: clusterResult.authored };
  }

  if (withGroups) {
    const groupResult = await mergeGroups(ctx, pending.groups, warnings);
    merged += groupResult.merged;
    skipped += groupResult.skipped;
    now.groups = { entry: groupResult.authored };
  }

  if (withFlows) {
    const flowResult = await mergeFlows(ctx, pending.flows, Boolean(fromPersistedSnapshot), warnings);
    merged += flowResult.merged;
    skipped += flowResult.skipped;
    now.flows = { entry: flowResult.authored };
  }

  // A graph rebuilt from a persisted snapshot lacks the live structure fingerprints are computed
  // over, so a historical `--sha` merge records nothing rather than minting wrong stamps.
  if (!fromPersistedSnapshot) {
    const store = options.committedStore ?? readStoreFromDisk(path.join(root, STORE_REL_DIR));
    const inputs = { graph: ctx.graph, snapshot: ctx.snapshot, docs: ctx.docs };
    const record = stampAuthored(inputs, readAuthoredRecord(ctx.scvDir, ctx.sha), now, authoredFromStore(store));
    writeAuthoredRecord(ctx.scvDir, ctx.sha, record);
  }

  return { merged, skipped, warnings };
}

function readPendingFile(pendingFile: string | undefined): PendingSemantics {
  if (pendingFile === undefined) throw new Error("mergeSemantics needs a pendingFile or an in-memory pending set");
  return PendingSemanticsSchema.parse(JSON.parse(readFileSync(pendingFile, "utf-8")));
}

async function mergeLayerClustering(
  ctx: ArtifactContext,
  pendingLayers: Record<string, PendingLayer>,
  functionUnits: Unit[],
  warnings: string[],
): Promise<{ merged: number; skipped: number; authored: Record<string, PendingLayer> }> {
  const { groups: clusterGroups, unitsByFile, modularity, directoryModularity } = computeClusters(functionUnits, ctx.snapshot.edges);

  const pendingByRealId = new Map<string, (typeof pendingLayers)[string]>();
  for (const [pendingId, entry] of Object.entries(pendingLayers)) {
    const realId = layerIdFor(entry.files);
    if (!clusterGroups.has(realId)) {
      warnings.push(`layer ${pendingId} (files: ${entry.files.join(", ")}) does not match any real cluster — skipped`);
      continue;
    }
    pendingByRealId.set(realId, entry);
  }

  // An agent may narrate only a subset of clusters per run. Any cluster this pending file
  // doesn't mention must keep whatever name/narration/provenance it already has in the cached
  // layers artifact (from a prior merge or a real Pass C) rather than being reset to a
  // placeholder — that reset is what made partial narration destructive.
  const cachedLayerById = new Map<string, Layer>();
  for (const layer of readArtifact<LayersData>(ctx, "layers")?.data.layers ?? []) {
    if (layer.source === "static") continue;
    cachedLayerById.set(layerIdFor(layer.files), layer);
  }

  let merged = 0;
  const skipped = Object.keys(pendingLayers).length - pendingByRealId.size;
  const layers: Layer[] = [];
  const parentOverride: [string, string][] = [];
  const layerIdByName: [string, string][] = [];
  const layerUnits: Unit[] = [];
  // Every narrated layer, carried or new, keyed by cluster id: the record holds the full set the
  // layers artifact now narrates, since export publishes it as one unit.
  const authored: Record<string, PendingLayer> = {};

  for (const [realId, realFiles] of clusterGroups) {
    const entry = pendingByRealId.get(realId);
    const layer: Layer = entry
      ? {
          name: entry.name,
          files: realFiles,
          what: entry.what,
          how: entry.how,
          when: entry.when,
          where: entry.where,
          why: entry.why,
          confidence: entry.confidence,
          source: "manual",
        }
      : (cachedLayerById.get(realId) ?? {
          name: realId,
          files: realFiles,
          what: "(no summary)",
          how: "(no summary)",
          when: "(no summary)",
          where: "(no summary)",
          why: "(no summary)",
          confidence: 0,
          source: "static",
        });
    layers.push(layer);
    layerIdByName.push([layer.name, realId]);
    if (layer.source !== "static") {
      const { name, files, what, how, when, where, why, confidence } = layer;
      authored[realId] = { name, files, what, how, when, where, why, confidence };
    }
    for (const file of realFiles) {
      for (const unit of unitsByFile.get(file) ?? []) parentOverride.push([unit.id, realId]);
    }

    const memberUnits = realFiles.flatMap((f) => unitsByFile.get(f) ?? []);
    const memberIds = memberUnits.map((u) => u.id);
    if (memberIds.length === 0) continue;
    layerUnits.push({
      id: realId,
      kind: "layer",
      name: layer.name,
      qualname: layer.name,
      lang: undefined,
      parent: null,
      children: memberIds,
      loc: {
        files: [...new Set(memberUnits.flatMap((u) => u.loc.files))],
        start: null,
        end: null,
        sloc: memberUnits.reduce((sum, u) => sum + u.loc.sloc, 0),
      },
      semantics: { what: layer.what, how: layer.how, when: layer.when, where: layer.where, why: layer.why, confidence: layer.confidence, source: layer.source },
      cost: null,
      tags: [],
      metrics: { sloc: memberUnits.reduce((sum, u) => sum + u.loc.sloc, 0), modules: memberIds.length },
      authors: undefined,
      hash: { struct: createHash("sha1").update([...memberIds].sort().join("")).digest("hex"), text: null, semantic: null },
      // Derived from where the layer's data actually came from, not from whether *this run's*
      // pending file happened to mention the cluster — otherwise carrying a previously-narrated
      // layer forward would preserve its text but stamp it `static`.
      provenance:
        layer.source === "manual"
          ? { source: "manual", pass: "C" }
          : layer.source === "llm"
            ? { source: "llm", pass: "C", provider: layer.provider, model: layer.model }
            : { source: "static" },
    });
    if (entry) merged++;
  }

  const layersData: LayersData = {
    layerUnits,
    layers,
    parentOverride,
    layerIdByName,
    repoContextText: undefined,
    clusteringVersion: CLUSTERING_VERSION,
    promptRev: ctx.promptRev,
  };

  const clustersData: ClustersData = {
    groups: [...clusterGroups],
    unitsByFile: [...unitsByFile].map(([file, units]) => [file, units.map((u) => u.id)]),
    repoContextText: undefined,
    modularity,
    directoryModularity,
    clusteringVersion: CLUSTERING_VERSION,
  };

  let docsStored = readArtifact<DocExtract[]>(ctx, "docs");
  if (!docsStored && ctx.docs.length > 0) {
    // No cached docs artifact, but discoverable doc files exist: this pending file has no doc
    // narration to offer (Phase 2 only authors layers/functions), and producing the real
    // narration would require an LLM call — the entire point of this zero-cost merge path is to
    // avoid that. Cache an empty docs artifact ourselves, under the SAME inputHash formula
    // `ensureArtifact("docs")` uses, so a later `scv analyze` sees a match and reuses it rather
    // than mismatching (which would force a layers recompute / Pass C) or silently overwriting it
    // with real narration behind our backs later on a hash that no longer matches this merge.
    // Docs narration is a known, visible gap in the zero-LLM workflow — not a silent one: warn.
    const docsInputHash = await computeInputHash("docs", ctx, {});
    writeArtifact(ctx, "docs", docsInputHash, []);
    docsStored = { inputHash: docsInputHash, data: [] };
    warnings.push("cached an empty docs artifact: doc files were discovered but no docs narration was available to merge — docs will show no summary until `scv analyze docs --force` is run with an LLM provider");
  }
  // computeInputHash reads only `functions.units` for clusters/layers/flows — the block fields
  // are structurally required by FunctionsData but never hashed, so they stay empty here.
  const clustersInputHash = await computeInputHash("clusters", ctx, {
    functions: { units: functionUnits, blockUnits: [], blockEdges: [] },
    docs: docsStored?.data ?? [],
  });
  writeArtifact(ctx, "clusters", clustersInputHash, clustersData);

  const layersInputHash = await computeInputHash("layers", ctx, {
    clusters: clustersData,
    functions: { units: functionUnits, blockUnits: [], blockEdges: [] },
  });
  writeArtifact(ctx, "layers", layersInputHash, layersData);

  return { merged, skipped, authored };
}

/** Never lets a stale artifact trigger a provider call — everything stale is empty-defaulted, and
 *  the caller decides what to do about it via `defaultedArtifacts`. */
const NO_PROVIDER = { allowProvider: new Set<ArtifactName>() };

/**
 * Merges agent-authored doc extracts into the `docs` artifact — the zero-LLM stand-in for Pass
 * Docs, which otherwise makes one provider call per README/docs file.
 *
 * `path` must name a doc `discoverDocs` actually found, since `computeInputHash("docs")` hashes
 * the discovered set: an entry for a file the pipeline never saw would be silently dropped on the
 * next analyze anyway. Failure modes are per-entry (warn + skip), so one bad path does not
 * discard the rest.
 *
 * The write is a union over the cached artifact, not a replacement: extracts a partial pending
 * file omits are preserved, a pending entry replaces the cached one for the same path, and a
 * cached path the repo no longer discovers is dropped. Output is sorted by path, so two merges of
 * the same content write byte-identical artifacts regardless of pending-file key order.
 */
async function mergeDocs(
  ctx: ArtifactContext,
  pendingDocs: Record<string, PendingDoc>,
  warnings: string[],
): Promise<{ merged: number; skipped: number; authored: PendingDoc[] }> {
  const discovered = new Set(ctx.docs.map((d) => d.path));

  // Seed from whatever a previous merge already wrote, so authoring docs across several passes
  // (or re-merging a file that covers only one doc) is additive rather than destructive. A
  // pending entry replaces the cached extract for the same path; a cached path the repo no
  // longer discovers is dropped, since the `docs` input hash is computed over the discovered set.
  const byPath = new Map<string, DocExtract>();
  for (const cached of readArtifact<DocExtract[]>(ctx, "docs")?.data ?? []) {
    if (discovered.has(cached.path)) byPath.set(cached.path, cached);
  }
  const claimed = new Set<string>();
  const authored: PendingDoc[] = [];
  let merged = 0;
  let skipped = 0;

  for (const [key, entry] of Object.entries(pendingDocs)) {
    if (!discovered.has(entry.path)) {
      warnings.push(`doc ${key}: path ${entry.path} was not discovered in this repo — skipped`);
      skipped++;
      continue;
    }
    if (claimed.has(entry.path)) {
      warnings.push(`doc ${key}: ${entry.path} is already claimed by an earlier entry — skipped`);
      skipped++;
      continue;
    }
    claimed.add(entry.path);
    const doc = { path: entry.path, purpose: entry.purpose, modules: entry.modules, architecture_notes: entry.architecture_notes };
    byPath.set(entry.path, doc);
    authored.push(doc);
    merged++;
  }

  const docs = [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  writeArtifact(ctx, "docs", await computeInputHash("docs", ctx, {}), docs);
  return { merged, skipped, authored };
}

/**
 * Overlays agent-authored block labels onto the labels recovered from a cached artifact.
 *
 * Labels are authored per function unit (`units[<id>].blockLabels`) and keyed by the extractor's
 * readable `blockId` — "decision:0", "loop:1". That id is not persisted verbatim:
 * `resolveBlockGraph` hashes it into `u:block:<hash>`. Since blocks are emitted in stable walker
 * order, the readable form is reconstructed here from each function's block sequence — counting
 * per `blockType`, exactly as the walkers mint it. The hashed `u:block:<hash>` form is accepted
 * too, so a caller reading ids straight out of `extraction.json` still works.
 *
 * An id no function owns, or a label on a unit with no block graph, is an authoring typo: warned
 * and skipped rather than aborting the merge, matching every other merge path in this file. A
 * `trueLabel`/`falseLabel` on a block that has no such outgoing edge is dropped the same way,
 * keeping the node label — the rest of the entry is still valid.
 */
function mergeBlockLabels(
  ctx: ArtifactContext,
  pendingUnits: Record<string, { blockLabels?: Record<string, PendingBlockLabel> }>,
  recovered: Map<string, Map<string, BlockLabelWithProvenance>>,
  warnings: string[],
): { labels: Map<string, Map<string, BlockLabelWithProvenance>>; merged: number; skipped: number } {
  const withLabels = Object.entries(pendingUnits).filter(([, u]) => u.blockLabels && Object.keys(u.blockLabels).length > 0);
  if (withLabels.length === 0) return { labels: recovered, merged: 0, skipped: 0 };

  // Per owning function unit: readable blockId ("decision:0") and hashed id -> the hashed id the
  // builder keys labels by. Readable ids are reconstructed in emission order, per blockType,
  // matching how `walk-python`/`walk-typescript` mint them.
  const unitIdByQualname = new Map(ctx.graph.units.map((u) => [u.qualname, u.id]));
  const resolvableByOwner = new Map<string, Map<string, string>>();
  const branchesByOwner = new Map<string, Map<string, Set<string>>>();
  for (const [qualname, bg] of Object.entries(ctx.graph.blockGraph)) {
    const owner = unitIdByQualname.get(qualname);
    if (!owner) continue;
    const resolvable = new Map<string, string>();
    const seen = new Map<string, number>();
    for (const block of bg.blocks) {
      const n = seen.get(block.blockType) ?? 0;
      seen.set(block.blockType, n + 1);
      resolvable.set(`${block.blockType}:${n}`, block.id);
      resolvable.set(block.id, block.id);
    }
    resolvableByOwner.set(owner, resolvable);
    // A branch label survives only on a block that is *both* a branching type and the real source
    // of that edge. The two gates catch different things and neither subsumes the other:
    //
    //   - Type gate (`decision`/`loop`): the authoring contract. Only these two read as branching
    //     to someone writing labels by hand, so a `trueLabel` on anything else is an authoring
    //     error, even where the graph happens to hang a "true" edge off a `sequential` block that
    //     sits on a branch (2 such blocks in `fixtures/orderly`). Labeling those would caption an
    //     edge the author never meant to name.
    //   - Edge gate: what actually renders. `buildBlockUnits` emits `edgeLabel` only for a
    //     "true"/"false" edge leaving that block, so a label on a block with no such edge is
    //     stored and never drawn. `loop` is the live case — it is branching by contract but exits
    //     via "loop-back", owning neither branch edge in this fixture.
    const branches = new Map<string, Set<string>>();
    for (const block of bg.blocks) {
      if (block.blockType === "decision" || block.blockType === "loop") branches.set(block.id, new Set());
    }
    for (const edge of bg.edges) {
      if (edge.edgeType !== "true" && edge.edgeType !== "false") continue;
      branches.get(edge.from)?.add(edge.edgeType);
    }
    branchesByOwner.set(owner, branches);
  }

  const labels = new Map([...recovered].map(([fn, m]) => [fn, new Map(m)]));
  let merged = 0;
  let skipped = 0;
  for (const [unitId, pendingUnit] of withLabels) {
    const resolvable = resolvableByOwner.get(unitId);
    if (!resolvable) {
      warnings.push(`unit ${unitId}: has blockLabels but no control-flow blocks in the current extraction — skipped`);
      skipped += Object.keys(pendingUnit.blockLabels!).length;
      continue;
    }
    for (const [blockId, pendingLabel] of Object.entries(pendingUnit.blockLabels!)) {
      const resolved = resolvable.get(blockId);
      if (!resolved) {
        warnings.push(`unit ${unitId}: block ${blockId} is not in this function's control-flow graph — skipped`);
        skipped++;
        continue;
      }
      // Drop a branch label the block cannot carry, keeping its node label: the merge is not
      // wrong, just over-specified, and silently storing an unrenderable field would leave the
      // author believing it took effect.
      const branching = branchesByOwner.get(unitId)?.has(resolved) ?? false;
      const owned = branchesByOwner.get(unitId)?.get(resolved) ?? new Set<string>();
      const label = { ...pendingLabel };
      for (const branch of ["true", "false"] as const) {
        const field = branch === "true" ? "trueLabel" : "falseLabel";
        if (label[field] === undefined) continue;
        if (!branching) {
          warnings.push(`unit ${unitId}: block ${blockId} is not a decision or loop — ${field} dropped, node label kept`);
          delete label[field];
        } else if (!owned.has(branch)) {
          warnings.push(`unit ${unitId}: block ${blockId} has no "${branch}" branch — ${field} dropped, node label kept`);
          delete label[field];
        }
      }

      const forFunction = labels.get(unitId) ?? new Map<string, BlockLabelWithProvenance>();
      forFunction.set(resolved, { label, provenance: { source: "manual", pass: "A" } });
      labels.set(unitId, forFunction);
      merged++;
    }
  }
  return { labels, merged, skipped };
}

/**
 * Merges agent-authored group narration into the `groups` artifact.
 *
 * Every failure mode here is per-entry: unlike Pass C — one LLM response, fail the batch —
 * one agent typo must not discard every other correctly-specified group. `buildGroupUnits` itself
 * throws on unknown members, double ownership and empty groups, so each of those is screened out
 * here (with a warning) *before* it can abort the whole call.
 */
async function mergeGroups(
  ctx: ArtifactContext,
  pendingGroups: Record<string, PendingGroup>,
  warnings: string[],
): Promise<{ merged: number; skipped: number; authored: Record<string, PendingGroup> }> {
  // Checked transitively: `ensureArtifact` resolves each dependency through its own recursive
  // call before hashing, so `clusters`/`functions`/`extraction` staleness propagates up into this
  // one set. A shallow "does layers.json's stored hash match a fresh computeInputHash" check would
  // pass even with a stale `functions` on disk, since both sides read the same stale file.
  const layersEnsured = await ensureArtifact("layers", ctx, NO_PROVIDER);
  if (layersEnsured.defaultedArtifacts.has("layers")) {
    throw new Error("layers artifact is missing or stale — run `scv analyze <root> layers` first, then merge with --with-groups");
  }
  const layersData = layersEnsured.data;
  const layerUnits = layersData.layerUnits;

  const idsByName = new Map<string, string[]>();
  for (const layer of layerUnits) {
    (idsByName.get(layer.name) ?? idsByName.set(layer.name, []).get(layer.name)!).push(layer.id);
  }

  interface ResolvedEntry {
    key: string;
    name: string;
    memberIds: string[];
    entry: (typeof pendingGroups)[string];
  }

  const resolved: ResolvedEntry[] = [];
  for (const [key, entry] of Object.entries(pendingGroups)) {
    const seen = new Set<string>();
    let bad = false;
    const memberIds: string[] = [];
    for (const layerName of entry.layers) {
      if (seen.has(layerName)) {
        warnings.push(`group "${key}" lists layer "${layerName}" more than once — skipped`);
        bad = true;
        break;
      }
      seen.add(layerName);
      const ids = idsByName.get(layerName) ?? [];
      if (ids.length !== 1) {
        warnings.push(`group "${key}" references unknown/ambiguous layer "${layerName}" — skipped`);
        bad = true;
        break;
      }
      memberIds.push(ids[0]!);
    }
    if (!bad) resolved.push({ key, name: entry.name, memberIds, entry });
  }

  // Overlap and name collisions both abort `buildGroupUnits` (or silently drop an entry, since the
  // object it takes is keyed by name), so screen them out here instead.
  const claimedBy = new Map<string, string>();
  const nonOverlapping: ResolvedEntry[] = [];
  for (const candidate of resolved) {
    const conflict = candidate.memberIds.find((id) => claimedBy.has(id));
    if (conflict !== undefined) {
      warnings.push(`group "${candidate.key}" claims layer '${conflict}', already claimed by "${claimedBy.get(conflict)}" — skipped`);
      continue;
    }
    for (const id of candidate.memberIds) claimedBy.set(id, candidate.key);
    nonOverlapping.push(candidate);
  }

  const keysByName = new Map<string, string[]>();
  for (const candidate of nonOverlapping) {
    (keysByName.get(candidate.name) ?? keysByName.set(candidate.name, []).get(candidate.name)!).push(candidate.key);
  }
  const surviving = nonOverlapping.filter((candidate) => {
    const keys = keysByName.get(candidate.name)!;
    if (keys.length === 1) return true;
    if (keys[0] === candidate.key) {
      warnings.push(`group name "${candidate.name}" is used by more than one pending entry (${keys.join(", ")}) — skipped`);
    }
    return false;
  });

  const groupsByName: Record<string, string[]> = {};
  // Built in name order, not pending-file key order, so reordering the pending file rewrites nothing.
  for (const candidate of [...surviving].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    groupsByName[candidate.name] = candidate.memberIds;
  }

  const built = buildGroupUnits({
    layerUnits,
    groups: groupsByName,
    systemId: systemIdFor(ctx.snapshot),
    provider: noopProvider,
  });

  // Matched by member-id set, not by `groupUnit.id` — that id is a hash of the sorted member ids,
  // which a pending file cannot predict, and not by name either, since the group unit's name is
  // exactly what the pending entry is free to change.
  const entryByMembers = new Map(surviving.map((candidate) => [[...candidate.memberIds].sort().join("\n"), candidate]));
  let merged = 0;
  const groupUnits = built.groupUnits.map((groupUnit) => {
    if (groupUnit.id === UNGROUPED_ID) return groupUnit;
    const candidate = entryByMembers.get([...groupUnit.children].sort().join("\n"));
    if (!candidate) return groupUnit;
    const { what, how, when, where, why, confidence } = candidate.entry;
    const semantics = { what, how, when, where, why, confidence, source: "manual" as const };
    merged++;
    return {
      ...groupUnit,
      semantics,
      // Recomputed because the built unit hashed `semantics: null`; leaving it would make the
      // hash lie about what it covers and hide this narration from any later diff.
      hash: { ...groupUnit.hash, semantic: createHash("sha1").update(semanticHashInput(groupUnit.name, semantics)).digest("hex") },
      provenance: { source: "manual" as const, pass: "C" as const },
    };
  });

  const groupsInputHash = await computeInputHash("groups", ctx, { layers: layersData });
  writeArtifact(ctx, "groups", groupsInputHash, { groupUnits, layerParent: [...built.layerParent] });

  const authored = Object.fromEntries(surviving.map((candidate) => [candidate.key, candidate.entry]));
  return { merged, skipped: Object.keys(pendingGroups).length - merged, authored };
}

/**
 * Merges agent-authored flow narration into the `flows` artifact.
 *
 * The trace itself is fully deterministic: it reuses `buildFlowTracingContext`/`traceFlowSteps`/
 * `buildFlowUnit` — the exact helpers `runFlowsPass` calls — so a merged flow's steps, DI prefix
 * and branch labels are identical to what the real pipeline would produce. Only the narration and
 * provenance differ.
 */
export async function mergeFlows(
  ctx: ArtifactContext,
  pendingFlows: Record<string, PendingFlow>,
  fromPersistedSnapshot: boolean,
  warnings: string[],
): Promise<{ merged: number; skipped: number; authored: Record<string, PendingFlow> }> {
  if (fromPersistedSnapshot) {
    // A persisted snapshot carries neither `via: "di"` edges nor a block graph (see
    // `graphFromSnapshot`), so every flow merged from one would have an empty DI prefix and no
    // branch labels — silently different from the real pipeline's output, not merely approximate.
    throw new Error("flow merging requires live extraction; historical --sha merges are not supported (no DI/block-graph data is persisted)");
  }

  // A never-persisted `functions` artifact is a legitimate zero-LLM state (a plain `--no-llm` run
  // defaults rather than writes), so fall back to the snapshot. A *present but stale* one is not:
  // tracing against outdated units is worse than tracing against the live structure.
  let functionUnits: Unit[];
  if (readArtifact<FunctionsData>(ctx, "functions")) {
    const ensured = await ensureArtifact("functions", ctx, NO_PROVIDER);
    if (ensured.defaultedArtifacts.has("functions")) {
      throw new Error("functions artifact is stale — run `scv analyze <root> functions` first, then merge with --with-flows");
    }
    functionUnits = ensured.data.units;
  } else {
    functionUnits = ctx.snapshot.units;
  }

  const tracing = buildFlowTracingContext({ snapshot: ctx.snapshot, graph: ctx.graph, units: functionUnits });
  const eligibleIds = new Set(tracing.flowUnitSummaries.map((u) => u.id));
  const knownUnitIds = new Set(functionUnits.map((u) => u.id));

  const flowUnits: Unit[] = [];
  const flowIds = new Set<string>();
  const authored: Record<string, PendingFlow> = {};
  let merged = 0;

  for (const [key, entry] of Object.entries(pendingFlows)) {
    if (!eligibleIds.has(entry.entryUnit)) {
      warnings.push(`flow "${key}" entryUnit '${entry.entryUnit}' is not an eligible entry point (needs a non-test function or class unit) — skipped`);
      continue;
    }
    const traced = traceFlowSteps(entry.entryUnit, knownUnitIds, tracing);
    if (!traced) {
      warnings.push(`flow "${key}" entryUnit '${entry.entryUnit}' traces fewer than two steps — skipped`);
      continue;
    }
    const flowUnit = buildFlowUnit({
      name: entry.name,
      route: entry.route,
      traced,
      semantics: {
        what: entry.what,
        how: entry.how,
        when: entry.when,
        where: entry.where,
        why: entry.why,
        confidence: entry.confidence,
        source: "manual",
      },
      tags: entry.tags,
      provenance: { source: "manual", pass: "C" },
    });
    if (flowIds.has(flowUnit.id)) {
      warnings.push(`flow "${key}" resolves to the same route and traced steps as an earlier entry — skipped`);
      continue;
    }
    flowIds.add(flowUnit.id);
    flowUnits.push(flowUnit);
    authored[key] = entry;
    merged++;
  }

  const flowsInputHash = await computeInputHash("flows", ctx, {
    functions: { units: functionUnits, blockUnits: [], blockEdges: [] },
  });
  // Sorted by id, not pending-file key order, so reordering the pending file rewrites nothing.
  writeArtifact(ctx, "flows", flowsInputHash, flowUnits.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));

  return { merged, skipped: Object.keys(pendingFlows).length - merged, authored };
}

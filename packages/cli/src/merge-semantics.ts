import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractRepo, isGeneratedPath, isTestPath, type SymbolGraph } from "@scv/extractor";
import { PendingSemanticsSchema, SnapshotSchema, semanticHashInput, type Edge, type PendingBlockLabel, type Snapshot, type Unit } from "@scv/schema";
import {
  runPassB,
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
  type ImportEdge,
  type Layer,
  type Provider,
} from "@scv/interpreter";
import { computeInputHash, ensureArtifact, type ArtifactContext, type ArtifactName } from "./artifacts.js";
import { assembleSnapshotFromCache } from "./assemble-snapshot.js";
import { discoverDocs } from "./discover-docs.js";
import { changedFiles, headRev } from "./rev.js";
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

interface StoredArtifact<T> {
  inputHash: string;
  data: T;
}

export interface MergeSemanticsOptions {
  pendingFile: string;
  ctx: ArtifactContext;
  /** Filesystem repo root, used by `--scope changed` to run `git diff` against. `ctx.snapshot.repo.root`
   *  is a display name (`path.basename`), not a usable path, so this must be passed separately. */
  root: string;
  scope?: string[];
  withClustering?: boolean;
  withGroups?: boolean;
  withFlows?: boolean;
  /** True when `ctx.graph` was rebuilt by `graphFromSnapshot` rather than a live `extractRepo`
   *  call. Such a graph has no `via: "di"` edges and an empty `blockGraph`, so flow merging must
   *  refuse rather than emit a silently degraded flow. */
  fromPersistedSnapshot?: boolean;
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

function artifactFile(ctx: ArtifactContext, name: string): string {
  return path.join(ctx.scvDir, "artifacts", ctx.sha, `${name}.json`);
}

function readArtifact<T>(ctx: ArtifactContext, name: string): StoredArtifact<T> | undefined {
  const file = artifactFile(ctx, name);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as StoredArtifact<T>;
  } catch {
    return undefined;
  }
}

function writeArtifact<T>(ctx: ArtifactContext, name: string, inputHash: string, data: T): void {
  const file = artifactFile(ctx, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ inputHash, data } satisfies StoredArtifact<T>));
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
  sha?: string;
}

const noopProvider: Provider = {
  name: "none",
  model: "none",
  interpret: () => {
    throw new Error("merge-semantics must never call the provider");
  },
};

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

  const ctx: ArtifactContext = {
    scvDir,
    sha: rev.sha,
    snapshot,
    graph,
    provider: noopProvider,
    promptRev: "p4",
    readSource: () => "",
    docs: discoverDocs(options.root),
    reportProgress: () => {},
    force: new Set(),
    noLlm: true,
  };

  const mergeResult = await mergeSemantics({
    pendingFile: options.pendingFile,
    ctx,
    root: options.root,
    scope: options.scope,
    withClustering: options.withClustering,
    withGroups: options.withGroups,
    withFlows: options.withFlows,
    fromPersistedSnapshot: persisted !== undefined,
  });
  const assembled = await assembleSnapshotFromCache({ ctx, rev, scvDir });

  return { ...mergeResult, snapshot: assembled.snapshot, path: assembled.path, emptyArtifacts: assembled.emptyArtifacts };
}

export async function mergeSemantics(options: MergeSemanticsOptions): Promise<MergeSemanticsResult> {
  const { pendingFile, ctx, root, scope, withClustering, withGroups, withFlows, fromPersistedSnapshot } = options;
  const warnings: string[] = [];

  const raw = JSON.parse(readFileSync(pendingFile, "utf-8"));
  const pending = PendingSemanticsSchema.parse(raw);

  const functionsStored = readArtifact<FunctionsData>(ctx, "functions");
  const functionsData: FunctionsData = functionsStored?.data ?? {
    units: ctx.snapshot.units,
    blockUnits: [],
    blockEdges: [],
  };

  // Block units are pure AST structure, so they cost nothing to rebuild here and must not be
  // left empty — without them the Flowchart view is silently blank on every agent-authored
  // path. Labels already earned by a cached artifact are recovered and carried through, so a
  // semantics-only merge never resets a labeled block to its structural fallback.
  const recoveredLabels = recoverBlockLabels(functionsData.blockUnits, functionsData.blockEdges);
  const blockLabelResult = mergeBlockLabels(ctx, pending.blockLabels, recoveredLabels, warnings);

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

  if (withClustering) {
    const clusterResult = await mergeLayerClustering(ctx, pending.layers, functionsData.units, warnings);
    merged += clusterResult.merged;
    skipped += clusterResult.skipped;
  }

  if (withGroups) {
    const groupResult = await mergeGroups(ctx, pending.groups, warnings);
    merged += groupResult.merged;
    skipped += groupResult.skipped;
  }

  if (withFlows) {
    const flowResult = await mergeFlows(ctx, pending.flows, Boolean(fromPersistedSnapshot), warnings);
    merged += flowResult.merged;
    skipped += flowResult.skipped;
  }

  return { merged, skipped, warnings };
}

async function mergeLayerClustering(
  ctx: ArtifactContext,
  pendingLayers: Record<string, { name: string; files: string[]; what: string; how: string; when: string; where: string; why: string; confidence: number }>,
  functionUnits: Unit[],
  warnings: string[],
): Promise<{ merged: number; skipped: number }> {
  const unitsByFile = new Map<string, Unit[]>();
  for (const unit of functionUnits) {
    if (unit.kind !== "module") continue;
    const file = unit.loc.files[0];
    if (!file || isTestPath(file) || isGeneratedPath(file)) continue;
    (unitsByFile.get(file) ?? unitsByFile.set(file, []).get(file)!).push(unit);
  }
  const files = [...unitsByFile.keys()];

  const fileOfUnit = new Map<string, string>();
  for (const unit of functionUnits) {
    if (unit.loc.files[0]) fileOfUnit.set(unit.id, unit.loc.files[0]);
  }

  const importEdges: ImportEdge[] = [];
  const edgeWeightByFilePair = new Map<string, number>();
  for (const edge of ctx.snapshot.edges) {
    const fromFile = fileOfUnit.get(edge.from);
    const toFile = fileOfUnit.get(edge.to);
    if (!fromFile || !toFile || fromFile === toFile) continue;
    const key = `${fromFile} ${toFile}`;
    edgeWeightByFilePair.set(key, (edgeWeightByFilePair.get(key) ?? 0) + edge.weight);
  }
  for (const [key, weight] of edgeWeightByFilePair) {
    const [from, to] = key.split(" ") as [string, string];
    importEdges.push({ from, to, weight });
  }

  const passB = runPassB({ files, edges: importEdges });

  const pendingByRealId = new Map<string, (typeof pendingLayers)[string]>();
  for (const [pendingId, entry] of Object.entries(pendingLayers)) {
    const realId = layerIdFor(entry.files);
    if (!passB.groups.has(realId)) {
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

  for (const [realId, realFiles] of passB.groups) {
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
    groups: [...passB.groups],
    unitsByFile: [...unitsByFile].map(([file, units]) => [file, units.map((u) => u.id)]),
    repoContextText: undefined,
    modularity: passB.modularity,
    directoryModularity: passB.directoryModularity,
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

  return { merged, skipped };
}

/** Never lets a stale artifact trigger a provider call — everything stale is empty-defaulted, and
 *  the caller decides what to do about it via `defaultedArtifacts`. */
const NO_PROVIDER = { allowProvider: new Set<ArtifactName>() };

/**
 * Overlays agent-authored block labels onto the labels recovered from a cached artifact.
 *
 * Pending labels are keyed by the block's `u:block:<hash>` unit id, the only block identity that
 * reaches `extraction.json` — the extractor's readable `blockId` ("decision:0") is internal and
 * never persisted. `buildBlockUnits` wants them grouped by owning function, so the owner is
 * resolved from the live block graph here; an id that no function owns is an authoring typo and
 * is warned + skipped rather than aborting the merge, matching every other merge path in this file.
 */
function mergeBlockLabels(
  ctx: ArtifactContext,
  pendingBlockLabels: Record<string, PendingBlockLabel>,
  recovered: Map<string, Map<string, BlockLabelWithProvenance>>,
  warnings: string[],
): { labels: Map<string, Map<string, BlockLabelWithProvenance>>; merged: number; skipped: number } {
  const entries = Object.entries(pendingBlockLabels);
  if (entries.length === 0) return { labels: recovered, merged: 0, skipped: 0 };

  // Block id -> the function unit id that owns it, straight off the live block graph.
  const ownerByBlockId = new Map<string, string>();
  const unitIdByQualname = new Map(ctx.graph.units.map((u) => [u.qualname, u.id]));
  for (const [qualname, bg] of Object.entries(ctx.graph.blockGraph)) {
    const owner = unitIdByQualname.get(qualname);
    if (!owner) continue;
    for (const block of bg.blocks) ownerByBlockId.set(block.id, owner);
  }

  const labels = new Map([...recovered].map(([fn, m]) => [fn, new Map(m)]));
  let merged = 0;
  let skipped = 0;
  for (const [blockId, pendingLabel] of entries) {
    const owner = ownerByBlockId.get(blockId);
    if (!owner) {
      warnings.push(`block label ${blockId}: no such block in the current extraction — skipped`);
      skipped++;
      continue;
    }
    const forFunction = labels.get(owner) ?? new Map<string, BlockLabelWithProvenance>();
    forFunction.set(blockId, { label: pendingLabel, provenance: { source: "manual", pass: "A" } });
    labels.set(owner, forFunction);
    merged++;
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
  pendingGroups: Record<string, { name: string; layers: string[]; what: string; how: string; when: string; where: string; why: string; confidence: number }>,
  warnings: string[],
): Promise<{ merged: number; skipped: number }> {
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
  for (const candidate of surviving) groupsByName[candidate.name] = candidate.memberIds;

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

  return { merged, skipped: Object.keys(pendingGroups).length - merged };
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
  pendingFlows: Record<string, { name: string; route: string; entryUnit: string; tags: string[]; what: string; how: string; when: string; where: string; why: string; confidence: number }>,
  fromPersistedSnapshot: boolean,
  warnings: string[],
): Promise<{ merged: number; skipped: number }> {
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
    merged++;
  }

  const flowsInputHash = await computeInputHash("flows", ctx, {
    functions: { units: functionUnits, blockUnits: [], blockEdges: [] },
  });
  writeArtifact(ctx, "flows", flowsInputHash, flowUnits);

  return { merged, skipped: Object.keys(pendingFlows).length - merged };
}

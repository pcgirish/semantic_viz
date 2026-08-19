import { createHash } from "node:crypto";
import type { SymbolGraph, SymbolBlockGraph, SymbolUnit } from "@scv/extractor";
import { isTestPath } from "@scv/extractor";
import type { Edge, Snapshot, Unit } from "@scv/schema";
import type { Provider } from "./provider.js";
import { runPassA } from "./pass-a.js";
import { runPassABlocks, type BlockLabel } from "./pass-a-blocks.js";
import { runPassB } from "./pass-b.js";
import { runPassC, runPassCGroups, proposeFlowEntryPoints, narrateFlow } from "./pass-c.js";
import { runPassDocs } from "./pass-docs.js";
import type { DocExtract, DocInput } from "./pass-docs.js";
import { traceFlow, traceFlowBranching } from "./checker.js";
import type { CallEdge, ImportEdge, StepBranch } from "./checker.js";
import type { FlowUnitSummary } from "./prompts/pass-c-flows.js";
import { topoOrder } from "./topo-order.js";

/** Local LLM servers (Ollama) run one generation at a time; firing hundreds of Pass A
 *  calls at once floods the connection and most fail outright rather than queueing. Cap
 *  how many run concurrently so a full-repo analyze stays reliable against a local model. */
const PASS_A_CONCURRENCY = 2;

/**
 * Runs `fn` over `ids` in `order`, honoring `dependenciesOf` — a unit only starts once its
 * direct dependencies (if present in `ids`) have finished — while still running up to `limit`
 * ready units concurrently. Best-effort: a cycle's dependency can never finish, so a unit whose
 * only unmet dependency is part of a cycle back-edge still eventually dispatches once
 * `topoOrder`'s cycle-breaking has made forward progress on everything else.
 */
async function runInDependencyOrder(
  order: string[],
  limit: number,
  dependenciesOf: (id: string) => string[],
  fn: (id: string) => Promise<void>,
): Promise<void> {
  const done = new Set<string>();
  const dispatching = new Set<string>();
  const positionOf = new Map(order.map((id, i) => [id, i]));
  const remaining = new Set(order);
  const inFlight = new Map<string, Promise<void>>();

  function isReady(id: string): boolean {
    return dependenciesOf(id)
      .filter((d) => positionOf.has(d))
      .every((d) => done.has(d) || !remaining.has(d));
  }

  while (remaining.size > 0 || inFlight.size > 0) {
    while (inFlight.size < limit && remaining.size > 0) {
      let pick: string | undefined;
      for (const id of order) {
        if (!remaining.has(id) || dispatching.has(id)) continue;
        if (isReady(id)) {
          pick = id;
          break;
        }
      }
      if (!pick) {
        // Nothing ready to dispatch right now: either everything remaining is blocked on
        // in-flight work (stop filling the batch, wait below) or nothing is in flight either,
        // which only happens inside a cycle whose dependency will never finish — take the
        // earliest remaining id to make progress.
        if (inFlight.size > 0) break;
        pick = order.find((id) => remaining.has(id) && !dispatching.has(id));
        if (!pick) break;
      }

      dispatching.add(pick);
      const task = fn(pick).then(() => {
        done.add(pick!);
        remaining.delete(pick!);
        dispatching.delete(pick!);
        inFlight.delete(pick!);
      });
      inFlight.set(pick, task);
    }

    if (inFlight.size > 0) await Promise.race(inFlight.values());
  }
}

/** Called as each phase makes progress: on dispatch (`done` unchanged, `current` names the
 *  entity just started) and on completion (`done` incremented). Lets a log consumer
 *  reconstruct "currently in process" at any point, not just the last completed item. */
export type ReportProgress = (phase: string, done: number, total: number, current?: string) => void;

export interface RunInterpreterOptions {
  snapshot: Snapshot;
  graph: SymbolGraph;
  provider: Provider;
  promptRev: string;
  /** Reads a leaf unit's source text for Pass A. Defaults to reading `unit.loc.file` from disk relative to `root`. */
  readSource: (file: string, start: number, end: number) => string;
  systemName?: string;
  /** Defaults to logging `[INFO] progress phase=... done/total current=... elapsed=...` to stderr. */
  reportProgress?: ReportProgress;
  /** Raw repo docs (README, docs/**), summarized via Pass Docs and combined with a directory
   *  tree into a "Repo context" section passed to Pass B/C. Optional — omitted entirely when absent. */
  repoContext?: { docs: DocInput[] };
}

/** Renders elapsed milliseconds as e.g. `1m42s` or `8s`, shared between per-line progress
 *  logging and the end-of-run summary so the format is consistent. */
export function fmtElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`;
}

const LEAF_KINDS = new Set(["function", "class"]);

/** Test code gets no LLM-generated summary/grouping/flow narration — only its structural
 *  fields (name, loc, hash) are kept in the snapshot (docs/plans/test-folder-flat-module-no-analysis.md). */
function isTestUnit(unit: Unit): boolean {
  const file = unit.loc.files[0];
  return file !== undefined && isTestPath(file);
}

function hashSemantics(semantics: unknown): string | null {
  if (!semantics) return null;
  return createHash("sha1").update(JSON.stringify(semantics)).digest("hex");
}

/**
 * Derives a layer's id from its file membership, not the LLM's chosen cluster name. Pass B/C
 * are not deterministic across runs — the same files can get named "ops" one run and
 * "operational-scripts" the next — so naming the id after the LLM's choice would make every
 * layer look removed-and-re-added on every re-analysis even when nothing changed.
 */
function layerIdFor(files: string[]): string {
  return `u:layer:${createHash("sha1").update([...files].sort().join("\n")).digest("hex").slice(0, 12)}`;
}

/** Renders a sorted file-path listing as an indented directory tree, so Pass B/C can see the
 *  repo's own layout without an extra disk walk (built from the same `files` list Pass B gets). */
function buildDirectoryTree(files: string[]): string {
  return [...files]
    .sort()
    .map((file) => {
      const parts = file.split("/");
      const depth = parts.length - 1;
      return `${"  ".repeat(depth)}${parts[parts.length - 1]}`;
    })
    .join("\n");
}

/** Combines Pass Docs' structured extracts with a directory tree into the single "Repo context"
 *  string passed to Pass B/C prompt builders. Returns undefined when there's nothing to add,
 *  so prompt builders omit the section entirely rather than rendering an empty one. */
function formatRepoContext(docExtracts: DocExtract[], files: string[]): string | undefined {
  const parts: string[] = [];

  for (const doc of docExtracts) {
    const lines = [`### ${doc.path}`, doc.purpose];
    for (const mod of doc.modules) {
      const paths = mod.paths.length > 0 ? ` (${mod.paths.join(", ")})` : "";
      lines.push(`- ${mod.name}${paths}: ${mod.description}`);
    }
    for (const note of doc.architecture_notes) lines.push(`- ${note}`);
    parts.push(lines.join("\n"));
  }

  if (files.length > 0) {
    parts.push(`### Directory structure\n${buildDirectoryTree(files)}`);
  }

  if (parts.length === 0) return undefined;
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------------------------
// Functions pass (Pass A leaf semantics + Pass A block labels)
// ---------------------------------------------------------------------------------------------

export interface RunFunctionsPassOptions {
  snapshot: Snapshot;
  graph: SymbolGraph;
  provider: Provider;
  promptRev: string;
  readSource: (file: string, start: number, end: number) => string;
  reportProgress: ReportProgress;
}

export interface RunFunctionsPassResult {
  /** All snapshot units, in original order, with Pass A semantics/cost/tags/signature applied
   *  to leaf (function/class) units and block-graph children appended where present. */
  units: Unit[];
  blockUnits: Unit[];
  blockEdges: Edge[];
}

/** Lifts leaf (function/class) units with Pass A semantics, then labels each function's
 *  control-flow blocks (Pass A-blocks). Bottom-up by call graph so a caller's prompt can see
 *  its callees' already-known one-liners inline. */
export async function runFunctionsPass(options: RunFunctionsPassOptions): Promise<RunFunctionsPassResult> {
  const { snapshot, graph, provider, promptRev, readSource, reportProgress } = options;
  const graphById = new Map(graph.units.map((u) => [u.id, u]));

  // Precomputed once (O(edges)) rather than per-unit (O(edges × units)) — static caller/callee
  // qualnames for Pass A's prompt context, plus id-keyed callees for dependency ordering below.
  const callersById = new Map<string, string[]>();
  const calleesById = new Map<string, string[]>();
  const calleeIdsById = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.kind !== "calls") continue;
    const fromUnit = graphById.get(edge.from);
    const toUnit = graphById.get(edge.to);
    if (fromUnit && toUnit) {
      (calleesById.get(edge.from) ?? calleesById.set(edge.from, []).get(edge.from)!).push(toUnit.qualname);
      (callersById.get(edge.to) ?? callersById.set(edge.to, []).get(edge.to)!).push(fromUnit.qualname);
    }
    (calleeIdsById.get(edge.from) ?? calleeIdsById.set(edge.from, []).get(edge.from)!).push(edge.to);
  }

  // Bottom-up: callees processed before callers, so a caller's prompt can carry its callees'
  // already-known one-liners inline (free — no extra LLM call). Reorder only leaf units by the
  // call graph; everything else keeps declaration order and runs through unchanged below.
  const snapshotUnitById = new Map(snapshot.units.map((u) => [u.id, u]));
  const leafIds = snapshot.units.filter((u) => LEAF_KINDS.has(u.kind) && !isTestUnit(u)).map((u) => u.id);
  const callEdgeRefs = graph.edges.filter((e) => e.kind === "calls").map((e) => ({ from: e.from, to: e.to }));
  const processingOrder = topoOrder(leafIds, callEdgeRefs);

  const knownOneLiners = new Map<string, string>();
  const passAResultById = new Map<string, Unit>();
  let passADone = 0;
  const passATotal = processingOrder.length;
  await runInDependencyOrder(processingOrder, PASS_A_CONCURRENCY, (id) => calleeIdsById.get(id) ?? [], async (id) => {
    const unit = snapshotUnitById.get(id)!;
    const symbolUnit = graphById.get(unit.id);
    if (!symbolUnit) {
      passAResultById.set(id, unit);
      passADone += 1;
      reportProgress("pass A", passADone, passATotal, unit.qualname);
      return;
    }
    reportProgress("pass A", passADone, passATotal, symbolUnit.qualname);

    const source = readSource(symbolUnit.loc.file, symbolUnit.loc.start, symbolUnit.loc.end);
    // A callee processed earlier in this run (bottom-up) has its fresh hash in
    // passAResultById; one not touched this run keeps its prior snapshot hash. Either way,
    // this digest changing invalidates the caller's cache entry even if the callee's one-liner
    // wasn't ready in time to be inlined into the prompt text itself.
    const calleeHashes = (calleeIdsById.get(unit.id) ?? [])
      .map((calleeId) => (passAResultById.get(calleeId) ?? snapshotUnitById.get(calleeId))?.hash.semantic)
      .filter((h): h is string => Boolean(h))
      .sort();
    const calleeSemanticsDigest = calleeHashes.length > 0 ? createHash("sha1").update(calleeHashes.join("")).digest("hex") : undefined;

    let result;
    try {
      result = await runPassA({
        unit: symbolUnit,
        source,
        provider,
        promptRev,
        callers: callersById.get(unit.id) ?? [],
        callees: calleesById.get(unit.id) ?? [],
        knownCalleeOneLiners: knownOneLiners,
        calleeSemanticsDigest,
      });
    } catch (err) {
      console.error(`pass A: ${unit.qualname ?? unit.id}: skipped — ${err instanceof Error ? err.message : String(err)}`);
      passAResultById.set(id, unit);
      passADone += 1;
      reportProgress("pass A", passADone, passATotal, symbolUnit.qualname);
      return;
    }

    if (result.semantics.what) knownOneLiners.set(symbolUnit.qualname, result.semantics.what);
    passAResultById.set(id, {
      ...unit,
      semantics: result.semantics,
      cost: result.cost,
      tags: result.tags,
      signature: result.signature,
      hash: { ...unit.hash, semantic: hashSemantics(result.semantics) },
    });
    passADone += 1;
    reportProgress("pass A", passADone, passATotal, symbolUnit.qualname);
  });

  const units: Unit[] = snapshot.units.map((unit) => passAResultById.get(unit.id) ?? unit);

  // Block units are pure AST structure (Part A/B in the flowchart-extraction plan) — no
  // LLM/layer/group context needed, so this can run right after Pass A and independent
  // of Pass B/C. Every function unit's SymbolGraph.blockGraph entry becomes block Units
  // parented under that function (so blocks show up in its `children`, same as any other
  // nesting in the schema) plus `control_flow` Edges carrying `flowType`.
  const blockUnits: Unit[] = [];
  const blockEdges: Edge[] = [];
  const blockChildrenByFunction = new Map<string, string[]>();
  const functionsWithBlocks: { unit: Unit; symbolUnit: SymbolUnit; bg: SymbolBlockGraph }[] = [];
  for (const unit of units) {
    if (unit.kind !== "function") continue;
    const symbolUnit = graphById.get(unit.id);
    if (!symbolUnit) continue;
    const bg = graph.blockGraph[symbolUnit.qualname];
    if (!bg) continue;
    functionsWithBlocks.push({ unit, symbolUnit, bg });
  }

  // Batched per-function LLM call giving each block a semantic label (Pass A-blocks,
  // docs/plans/flowchart-block-labels-readability.md) instead of the raw blockType/condition
  // fallback. Failure never blocks the run — an unlabeled function's blocks just keep the
  // structural fallback, same as Pass A's own failure handling above.
  const blockLabelsByFunction = new Map<string, Map<string, BlockLabel>>();
  let passABlocksDone = 0;
  const passABlocksTotal = functionsWithBlocks.length;
  await runInDependencyOrder(
    functionsWithBlocks.map((f) => f.unit.id),
    PASS_A_CONCURRENCY,
    () => [],
    async (unitId) => {
      const { unit, symbolUnit, bg } = functionsWithBlocks.find((f) => f.unit.id === unitId)!;
      reportProgress("pass A blocks", passABlocksDone, passABlocksTotal, symbolUnit.qualname);
      const functionSource = readSource(symbolUnit.loc.file, symbolUnit.loc.start, symbolUnit.loc.end);
      try {
        const labels = await runPassABlocks({
          blocks: bg.blocks,
          source: functionSource,
          functionQualname: symbolUnit.qualname,
          provider,
          promptRev,
        });
        blockLabelsByFunction.set(unit.id, labels);
      } catch (err) {
        console.error(`pass A blocks: ${symbolUnit.qualname}: skipped — ${err instanceof Error ? err.message : String(err)}`);
      }
      passABlocksDone += 1;
      reportProgress("pass A blocks", passABlocksDone, passABlocksTotal, symbolUnit.qualname);
    },
  );

  for (const { unit, bg } of functionsWithBlocks) {
    const labels = blockLabelsByFunction.get(unit.id);
    const childIds: string[] = [];
    for (const block of bg.blocks) {
      childIds.push(block.id);
      blockUnits.push({
        id: block.id,
        kind: "block",
        name: labels?.get(block.id)?.label ?? block.condition ?? block.blockType,
        qualname: block.id,
        lang: undefined,
        parent: unit.id,
        children: [],
        loc: { files: unit.loc.files, start: block.startLine, end: block.endLine, sloc: block.endLine - block.startLine + 1 },
        signature: null,
        semantics: null,
        cost: null,
        tags: [],
        metrics: {},
        authors: undefined,
        hash: { struct: null, text: null, semantic: null },
        provenance: { source: "static" },
      });
    }
    blockChildrenByFunction.set(unit.id, childIds);

    for (const edge of bg.edges) {
      const fromLabel = labels?.get(edge.from);
      const edgeLabel = edge.edgeType === "true" ? fromLabel?.trueLabel : edge.edgeType === "false" ? fromLabel?.falseLabel : undefined;
      blockEdges.push({
        id: `e:cf:${createHash("sha1").update(`${edge.from}${edge.to}${edge.edgeType}`).digest("hex").slice(0, 10)}`,
        from: edge.from,
        to: edge.to,
        kind: "control_flow",
        weight: 1,
        evidence: [],
        source: "static",
        confidence: 1,
        flowType: edge.edgeType,
        edgeLabel,
      });
    }
  }
  const unitsWithBlockChildren = units.map((unit) => {
    const childIds = blockChildrenByFunction.get(unit.id);
    if (!childIds) return unit;
    return { ...unit, children: [...unit.children, ...childIds] };
  });

  return { units: unitsWithBlockChildren, blockUnits, blockEdges };
}

// ---------------------------------------------------------------------------------------------
// Docs pass (Pass Docs)
// ---------------------------------------------------------------------------------------------

export interface RunDocsPassOptions {
  docs: DocInput[];
  provider: Provider;
  promptRev: string;
  reportProgress: ReportProgress;
}

/** Extracts structured module/architecture info from raw repo docs (README, docs/**). */
export async function runDocsPass(options: RunDocsPassOptions): Promise<DocExtract[]> {
  const { docs, provider, promptRev, reportProgress } = options;
  reportProgress("pass docs", 0, 1, "extracting doc structure");
  const docExtracts = docs.length ? await runPassDocs({ docs, provider, promptRev }) : [];
  reportProgress("pass docs", 1, 1, "extracting doc structure");
  return docExtracts;
}

// ---------------------------------------------------------------------------------------------
// Layers pass (Pass B clustering + Pass C narration)
// ---------------------------------------------------------------------------------------------

export interface RunLayersPassOptions {
  snapshot: Snapshot;
  /** Functions-pass output: all units (leaf semantics + block children already applied). */
  units: Unit[];
  docExtracts: DocExtract[];
  provider: Provider;
  promptRev: string;
  reportProgress: ReportProgress;
}

export interface RunLayersPassResult {
  layerUnits: Unit[];
  /** Maps a module unit's id to the layer id it was clustered into. */
  parentOverride: Map<string, string>;
  /** Every module unit, keyed by the file(s) it covers — reused by groups/finalize. */
  unitsByFile: Map<string, Unit[]>;
  /** Directory tree + doc context text passed into Pass B/C prompts, reused unchanged by groups. */
  repoContextText: string | undefined;
  layerIdByName: Map<string, string>;
}

/** Clusters modules into named layers (Pass B) and narrates each layer's purpose (Pass C). */
export async function runLayersPass(options: RunLayersPassOptions): Promise<RunLayersPassResult> {
  const { snapshot, units, docExtracts, provider, promptRev, reportProgress } = options;

  const unitsByFile = new Map<string, Unit[]>();
  for (const unit of units) {
    if (unit.kind !== "module" || isTestUnit(unit)) continue;
    for (const file of unit.loc.files) {
      (unitsByFile.get(file) ?? unitsByFile.set(file, []).get(file)!).push(unit);
    }
  }
  const files = [...unitsByFile.keys()];

  const leafUnitsByFile = new Map<string, Unit[]>();
  for (const unit of units) {
    if (!LEAF_KINDS.has(unit.kind) || isTestUnit(unit)) continue;
    for (const file of unit.loc.files) {
      (leafUnitsByFile.get(file) ?? leafUnitsByFile.set(file, []).get(file)!).push(unit);
    }
  }
  const oneLiners: Record<string, string> = {};
  for (const file of files) {
    const withSemantics = leafUnitsByFile.get(file)?.find((u) => u.semantics);
    oneLiners[file] = withSemantics?.semantics?.what ?? "(no summary)";
  }

  const fileOfUnit = new Map<string, string>();
  for (const unit of units) {
    if (unit.loc.files[0]) fileOfUnit.set(unit.id, unit.loc.files[0]);
  }

  const importEdges: ImportEdge[] = [];
  const edgeWeightByFilePair = new Map<string, number>();
  for (const edge of snapshot.edges) {
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

  const repoContextText = formatRepoContext(docExtracts, files);

  reportProgress("pass B", 0, 1, "clustering files");
  const passB = await runPassB({ files, oneLiners, edges: importEdges, provider, promptRev, repoContext: repoContextText });
  reportProgress("pass B", 1, 1, "clustering files");

  const layerIds: string[] = [];
  const parentOverride = new Map<string, string>();

  for (const [, clusterFiles] of Object.entries(passB.clusters)) {
    const memberUnits = clusterFiles.flatMap((f) => unitsByFile.get(f) ?? []);
    if (memberUnits.length === 0) continue;
    const layerId = layerIdFor(clusterFiles);
    layerIds.push(layerId);
    for (const member of memberUnits) parentOverride.set(member.id, layerId);
  }

  reportProgress("pass C", 0, 1, "narrating layers");
  const passC = await runPassC({ clusters: passB.clusters, oneLiners, provider, promptRev, repoContext: repoContextText });
  reportProgress("pass C", 1, 1, "narrating layers");

  const layerIdByName = new Map(passC.layers.map((l) => [l.name, layerIdFor(l.files)]));

  const layerUnits: Unit[] = [];
  for (const layer of passC.layers) {
    const layerId = layerIdFor(layer.files);
    const memberUnits = layer.files.flatMap((f) => unitsByFile.get(f) ?? []);
    const memberIds = memberUnits.map((u) => u.id);
    if (memberIds.length === 0) continue;
    layerUnits.push({
      id: layerId,
      kind: "layer",
      name: layer.name,
      qualname: layer.name,
      lang: undefined,
      parent: null,
      children: memberIds,
      group: undefined,
      loc: {
        files: [...new Set(memberUnits.flatMap((u) => u.loc.files))],
        start: null,
        end: null,
        sloc: memberUnits.reduce((sum, u) => sum + u.loc.sloc, 0),
      },
      semantics: { what: layer.what, how: layer.how, when: layer.when, where: layer.where, why: layer.why, confidence: layer.confidence, source: "llm" },
      cost: null,
      tags: [],
      metrics: { sloc: memberUnits.reduce((sum, u) => sum + u.loc.sloc, 0), modules: memberIds.length },
      authors: undefined,
      hash: { struct: createHash("sha1").update([...memberIds].sort().join("")).digest("hex"), text: null, semantic: null },
      provenance: { source: "llm", pass: "C" },
    });
  }

  return { layerUnits, parentOverride, unitsByFile, repoContextText, layerIdByName };
}

// ---------------------------------------------------------------------------------------------
// Groups pass (Pass C groups)
// ---------------------------------------------------------------------------------------------

export interface RunGroupsPassOptions {
  snapshot: Snapshot;
  /** Layers-pass output. */
  layerUnits: Unit[];
  parentOverride: Map<string, string>;
  unitsByFile: Map<string, Unit[]>;
  layerIdByName: Map<string, string>;
  repoContextText: string | undefined;
  provider: Provider;
  promptRev: string;
  reportProgress: ReportProgress;
}

/** Buckets layers into a small number of named architectural groups (Pass C groups), returning
 *  layer units with their `group` field populated. */
export async function runGroupsPass(options: RunGroupsPassOptions): Promise<Unit[]> {
  const { snapshot, layerUnits, parentOverride, unitsByFile, layerIdByName, repoContextText, provider, promptRev, reportProgress } = options;

  const fileOfUnit = new Map<string, string>();
  for (const units of unitsByFile.values()) {
    for (const unit of units) {
      if (unit.loc.files[0]) fileOfUnit.set(unit.id, unit.loc.files[0]);
    }
  }

  // Layer-to-layer edge weights, rolled up the same way importEdges rolls up file-pair
  // weights in the layers pass — one level higher, keyed by layer id via parentOverride — so
  // the grouping step sees which layers actually depend on each other, not just their names.
  const layerEdgeWeightForGrouping = new Map<string, number>();
  for (const edge of snapshot.edges) {
    const fromFile = fileOfUnit.get(edge.from);
    const toFile = fileOfUnit.get(edge.to);
    const fromModuleUnit = fromFile ? unitsByFile.get(fromFile)?.[0] : undefined;
    const toModuleUnit = toFile ? unitsByFile.get(toFile)?.[0] : undefined;
    const fromLayer = fromModuleUnit ? parentOverride.get(fromModuleUnit.id) : undefined;
    const toLayer = toModuleUnit ? parentOverride.get(toModuleUnit.id) : undefined;
    if (!fromLayer || !toLayer || fromLayer === toLayer) continue;
    const key = `${fromLayer} ${toLayer}`;
    layerEdgeWeightForGrouping.set(key, (layerEdgeWeightForGrouping.get(key) ?? 0) + edge.weight);
  }
  const layerNameById = new Map([...layerIdByName].map(([name, id]) => [id, name]));
  const groupEdges: ImportEdge[] = [];
  for (const [key, weight] of layerEdgeWeightForGrouping) {
    const [fromId, toId] = key.split(" ") as [string, string];
    const fromName = layerNameById.get(fromId);
    const toName = layerNameById.get(toId);
    if (!fromName || !toName) continue;
    groupEdges.push({ from: fromName, to: toName, weight });
  }

  reportProgress("pass C groups", 0, 1, "grouping layers");
  const passCGroups = await runPassCGroups({
    layers: layerUnits.map((l) => ({ name: l.name, why: l.semantics?.why ?? "" })),
    edges: groupEdges,
    provider,
    promptRev,
    repoContext: repoContextText,
  });
  reportProgress("pass C groups", 1, 1, "grouping layers");
  const groupByLayerName = new Map<string, string>();
  for (const [groupName, layerNames] of Object.entries(passCGroups.groups)) {
    for (const layerName of layerNames) groupByLayerName.set(layerName, groupName);
  }

  return layerUnits.map((layer) => ({ ...layer, group: groupByLayerName.get(layer.name) }));
}

// ---------------------------------------------------------------------------------------------
// Flows pass (Pass C flows)
// ---------------------------------------------------------------------------------------------

export interface RunFlowsPassOptions {
  snapshot: Snapshot;
  graph: SymbolGraph;
  /** Functions-pass output. */
  units: Unit[];
  provider: Provider;
  promptRev: string;
  reportProgress: ReportProgress;
}

/** Traces API-entry-point call chains (Pass C flows), producing narrated `api_flow` units. */
export async function runFlowsPass(options: RunFlowsPassOptions): Promise<Unit[]> {
  const { snapshot, graph, units, provider, promptRev, reportProgress } = options;

  const functionsWithBlocks: { unit: Unit; symbolUnit: SymbolUnit; bg: SymbolBlockGraph }[] = [];
  const graphById = new Map(graph.units.map((u) => [u.id, u]));
  for (const unit of units) {
    if (unit.kind !== "function") continue;
    const symbolUnit = graphById.get(unit.id);
    if (!symbolUnit) continue;
    const bg = graph.blockGraph[symbolUnit.qualname];
    if (!bg) continue;
    functionsWithBlocks.push({ unit, symbolUnit, bg });
  }

  // Attributes each `calls` edge to the control-flow branch its call site sits in, so
  // traceFlowBranching can label a fan-out ("success"/"failure") instead of an unlabeled
  // tree. Joins on line ranges: a call's evidence line falls inside some block's
  // [startLine, endLine], and that block's incoming control_flow edge (true/false/exception)
  // says which branch it is. "true"/"false" become "success"/"failure" — the common shape for
  // a validation if/else — everything else (exception, loop-back) passes through as-is.
  const blockRangesByFunction = new Map<string, { id: string; startLine: number; endLine: number }[]>();
  const branchTypeByBlockId = new Map<string, string>();
  for (const { symbolUnit, bg } of functionsWithBlocks) {
    blockRangesByFunction.set(symbolUnit.qualname, bg.blocks.map((b) => ({ id: b.id, startLine: b.startLine, endLine: b.endLine })));
    for (const edge of bg.edges) {
      if (edge.edgeType !== "sequential") branchTypeByBlockId.set(edge.to, edge.edgeType);
    }
  }
  const qualnameByFile = new Map(functionsWithBlocks.map((f) => [f.symbolUnit.loc.file, f.symbolUnit.qualname]));
  const unitByIdForLabeling = new Map(units.map((u) => [u.id, u]));
  function branchLabelFor(fromUnitId: string, evidence: { file: string; line: number }[] | undefined): string | undefined {
    const line = evidence?.[0]?.line;
    if (line === undefined) return undefined;
    const fromUnit = unitByIdForLabeling.get(fromUnitId);
    const qualname = fromUnit ? qualnameByFile.get(fromUnit.loc.files[0] ?? "") : undefined;
    const ranges = qualname ? blockRangesByFunction.get(qualname) : undefined;
    const block = ranges?.find((r) => line >= r.startLine && line <= r.endLine);
    const branchType = block ? branchTypeByBlockId.get(block.id) : undefined;
    if (branchType === "true") return "success";
    if (branchType === "false") return "failure";
    return branchType;
  }

  // FastAPI-style DI/middleware (e.g. router `Depends()`) runs before a handler body but is
  // never called from it, so it never shows up as a normal `calls` edge from the handler.
  // `graph.edges` (the pre-schema SymbolGraph) carries `via: "di"` for these — the schema's
  // Edge type doesn't — so read it from there, exclude it from the body trace's callEdges
  // (else it fans out as just another branch), and splice each dependency in separately as a
  // linear prefix ahead of the handler.
  const diDependenciesByHandler = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.via !== "di") continue;
    (diDependenciesByHandler.get(edge.from) ?? diDependenciesByHandler.set(edge.from, []).get(edge.from)!).push(edge.to);
  }

  const callEdges: CallEdge[] = snapshot.edges
    .filter((e) => e.kind === "calls" && !diDependenciesByHandler.get(e.from)?.includes(e.to))
    .map((e) => ({ from: e.from, to: e.to, label: branchLabelFor(e.from, e.evidence) }));
  const flowUnitSummaries: FlowUnitSummary[] = units
    .filter((u) => LEAF_KINDS.has(u.kind) && !isTestUnit(u))
    .map((u) => ({ id: u.id, qualname: u.qualname, what: u.semantics?.what ?? "" }));
  const unitById = new Map(units.map((u) => [u.id, u]));

  const flowUnitIds = new Set(flowUnitSummaries.map((u) => u.id));
  const routeHints = graph.routes.filter((r) => flowUnitIds.has(r.unit));

  const newUnits: Unit[] = [];
  if (flowUnitSummaries.length > 0) {
    reportProgress("pass C flows: entry points", 0, 1, "proposing entry points");
    const proposed = await proposeFlowEntryPoints({ units: flowUnitSummaries, callEdges, provider, promptRev, routeHints });
    reportProgress("pass C flows: entry points", 1, 1, "proposing entry points");

    // Structural route hints are ground truth, not a suggestion: union in any hinted route
    // handler the LLM's response didn't happen to echo back, so entry-point detection for the
    // route-handler subset never depends on LLM sampling.
    const proposedUnitIds = new Set(proposed.map((f) => f.unit));
    const entryPoints = [
      ...proposed,
      ...routeHints
        .filter((h) => !proposedUnitIds.has(h.unit))
        .map((h) => ({ unit: h.unit, name: `${h.method.toUpperCase()} ${h.path}`, route: `${h.method.toUpperCase()} ${h.path}` })),
    ];
    const knownUnitIds = new Set(units.map((u) => u.id));

    let flowNarrationDone = 0;
    const flowNarrationTotal = entryPoints.length;
    for (const entry of entryPoints) {
      const bodySteps = traceFlow(entry.unit, knownUnitIds, callEdges);
      if (!bodySteps || bodySteps.length < 2) continue;
      const bodyBranching = traceFlowBranching(entry.unit, knownUnitIds, callEdges) ?? undefined;

      const diSteps = (diDependenciesByHandler.get(entry.unit) ?? []).filter((id) => knownUnitIds.has(id));
      const steps = [...diSteps, ...bodySteps];
      const stepsBranching = diSteps.reduceRight<StepBranch | undefined>(
        (child, unit) => ({ unit, children: child ? [child] : [] }),
        bodyBranching,
      );

      const stepUnits = steps.map((id) => unitById.get(id)).filter((u): u is Unit => Boolean(u));
      reportProgress("pass C flows: narration", flowNarrationDone, flowNarrationTotal, entry.route);
      const narration = await narrateFlow({
        route: entry.route,
        name: entry.name,
        steps: stepUnits.map((u) => ({ qualname: u.qualname, what: u.semantics?.what ?? "" })),
        provider,
        promptRev,
      });
      flowNarrationDone += 1;
      reportProgress("pass C flows: narration", flowNarrationDone, flowNarrationTotal, entry.route);

      // Hash the traced steps, not the LLM's route/name text — two distinct entry points can
      // get the same route label from the LLM (e.g. two similarly-shaped handlers both read as
      // "POST /orders"), and an id keyed on that label alone would collide and silently drop one.
      const flowId = `u:flow:${createHash("sha1").update(`${entry.route}\n${steps.join("\n")}`).digest("hex").slice(0, 8)}`;
      newUnits.push({
        id: flowId,
        kind: "api_flow",
        name: entry.name,
        qualname: entry.route,
        lang: undefined,
        parent: null,
        children: [],
        route: entry.route,
        steps,
        stepsBranching,
        loc: {
          files: [...new Set(stepUnits.flatMap((u) => u.loc.files))],
          start: null,
          end: null,
          sloc: stepUnits.reduce((sum, u) => sum + u.loc.sloc, 0),
        },
        semantics: {
          what: narration.what,
          how: narration.how,
          when: narration.when,
          where: narration.where,
          why: narration.why,
          confidence: narration.confidence,
          source: "llm",
        },
        cost: null,
        tags: narration.tags,
        metrics: { hops: steps.length, sloc: stepUnits.reduce((sum, u) => sum + u.loc.sloc, 0) },
        authors: undefined,
        hash: { struct: createHash("sha1").update(steps.join("")).digest("hex"), text: null, semantic: null },
        provenance: { source: "llm", pass: "C" },
      });
    }
  }

  return newUnits;
}

// ---------------------------------------------------------------------------------------------
// Finalize: merges functions/layers/groups/flows outputs into one scv/1 Snapshot
// ---------------------------------------------------------------------------------------------

export interface FinalizeSnapshotOptions {
  snapshot: Snapshot;
  provider: Provider;
  promptRev: string;
  systemName?: string;
  /** Functions-pass output. */
  units: Unit[];
  blockUnits: Unit[];
  blockEdges: Edge[];
  /** Layers-pass output (groups already merged in via runGroupsPass, or ungrouped if groups
   *  weren't run). */
  layerUnits: Unit[];
  parentOverride: Map<string, string>;
  /** Flows-pass output. Pass an empty array when flows weren't run. */
  flowUnits: Unit[];
}

/** Merges the functions/layers/groups/flows pass outputs into one scv/1 Snapshot: reparents
 *  modules under their layer, rolls up layer-to-layer edges, and adds a root system unit. */
export function finalizeSnapshot(options: FinalizeSnapshotOptions): Snapshot {
  const { snapshot, provider, promptRev, systemName, units, blockUnits, blockEdges, layerUnits, parentOverride, flowUnits } = options;

  const newUnits: Unit[] = [...layerUnits, ...flowUnits];

  const sysId = `u:sys:${systemName ?? snapshot.repo.root}`;
  newUnits.push({
    id: sysId,
    kind: "system",
    name: systemName ?? snapshot.repo.root,
    qualname: systemName ?? snapshot.repo.root,
    lang: undefined,
    parent: null,
    children: newUnits.map((u) => u.id),
    loc: {
      files: [...new Set(units.flatMap((u) => u.loc.files))],
      start: null,
      end: null,
      sloc: units.filter((u) => u.kind === "module").reduce((sum, u) => sum + u.loc.sloc, 0),
    },
    semantics: null,
    cost: null,
    tags: [],
    metrics: { modules: units.filter((u) => u.kind === "module").length, layers: newUnits.length },
    authors: undefined,
    hash: { struct: createHash("sha1").update(newUnits.map((u) => u.id).sort().join("")).digest("hex"), text: null, semantic: null },
    provenance: { source: "llm", pass: "C" },
  });

  const finalUnits = units.map((unit) => {
    const newParent = parentOverride.get(unit.id);
    if (newParent && unit.kind === "module") {
      return { ...unit, parent: newParent };
    }
    return unit;
  });

  const fileOfUnit = new Map<string, string>();
  for (const unit of units) {
    if (unit.loc.files[0]) fileOfUnit.set(unit.id, unit.loc.files[0]);
  }

  const edges: Edge[] = [...snapshot.edges, ...blockEdges];
  const layerOfFile = new Map<string, string>();
  for (const unit of finalUnits) {
    if (unit.kind === "module" && parentOverride.has(unit.id)) {
      for (const f of unit.loc.files) layerOfFile.set(f, parentOverride.get(unit.id)!);
    }
  }
  const layerEdgeWeight = new Map<string, { from: string; to: string; kind: Edge["kind"]; weight: number }>();
  for (const edge of snapshot.edges) {
    const fromFile = fileOfUnit.get(edge.from);
    const toFile = fileOfUnit.get(edge.to);
    const fromLayer = fromFile ? layerOfFile.get(fromFile) : undefined;
    const toLayer = toFile ? layerOfFile.get(toFile) : undefined;
    if (!fromLayer || !toLayer || fromLayer === toLayer) continue;
    const key = `${fromLayer} ${toLayer} ${edge.kind}`;
    const existing = layerEdgeWeight.get(key);
    if (existing) existing.weight += edge.weight;
    else layerEdgeWeight.set(key, { from: fromLayer, to: toLayer, kind: edge.kind, weight: edge.weight });
  }
  for (const [key, agg] of layerEdgeWeight) {
    edges.push({
      id: `e:${createHash("sha1").update(key).digest("hex").slice(0, 10)}`,
      from: agg.from,
      to: agg.to,
      kind: agg.kind,
      weight: agg.weight,
      evidence: [],
      source: "static",
      confidence: 1,
      rollup: true,
    });
  }

  return {
    ...snapshot,
    units: [...finalUnits, ...newUnits, ...blockUnits],
    edges,
    provenance: {
      ...snapshot.provenance,
      interpreter: { provider: provider.name, model: provider.model, prompt_rev: promptRev },
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Full pipeline
// ---------------------------------------------------------------------------------------------

/** Runs Pass A (leaf semantics), Pass B (clustering), and Pass C (layer + system narration) over a structural snapshot, producing a fully-lifted scv/1 snapshot. Mirrors docs/mock/tools/build.py's interpret(). */
export async function runInterpreter(options: RunInterpreterOptions): Promise<Snapshot> {
  const { snapshot, graph, provider, promptRev, readSource, systemName, repoContext } = options;
  const runStart = performance.now();
  const reportProgress: ReportProgress =
    options.reportProgress ??
    ((phase, done, total, current) =>
      console.error(`[INFO] progress phase=${phase} ${done}/${total} current=${current ?? ""} elapsed=${fmtElapsed(performance.now() - runStart)}`));

  const { units, blockUnits, blockEdges } = await runFunctionsPass({ snapshot, graph, provider, promptRev, readSource, reportProgress });

  const docExtracts = await runDocsPass({ docs: repoContext?.docs ?? [], provider, promptRev, reportProgress });

  const { layerUnits: ungroupedLayerUnits, parentOverride, unitsByFile, repoContextText, layerIdByName } = await runLayersPass({
    snapshot,
    units,
    docExtracts,
    provider,
    promptRev,
    reportProgress,
  });

  const layerUnits = await runGroupsPass({
    snapshot,
    layerUnits: ungroupedLayerUnits,
    parentOverride,
    unitsByFile,
    layerIdByName,
    repoContextText,
    provider,
    promptRev,
    reportProgress,
  });

  const flowUnits = await runFlowsPass({ snapshot, graph, units, provider, promptRev, reportProgress });

  return finalizeSnapshot({ snapshot, provider, promptRev, systemName, units, blockUnits, blockEdges, layerUnits, parentOverride, flowUnits });
}

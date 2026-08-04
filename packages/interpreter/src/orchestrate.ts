import { createHash } from "node:crypto";
import type { SymbolGraph, SymbolBlockGraph, SymbolUnit } from "@scv/extractor";
import type { Edge, Snapshot, Unit } from "@scv/schema";
import type { Provider } from "./provider.js";
import { runPassA } from "./pass-a.js";
import { runPassABlocks } from "./pass-a-blocks.js";
import { runPassB } from "./pass-b.js";
import { runPassC, runPassCGroups, proposeFlowEntryPoints, narrateFlow } from "./pass-c.js";
import { traceFlow } from "./checker.js";
import type { CallEdge, ImportEdge } from "./checker.js";
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

export interface RunInterpreterOptions {
  snapshot: Snapshot;
  graph: SymbolGraph;
  provider: Provider;
  promptRev: string;
  /** Reads a leaf unit's source text for Pass A. Defaults to reading `unit.loc.file` from disk relative to `root`. */
  readSource: (file: string, start: number, end: number) => string;
  systemName?: string;
}

const LEAF_KINDS = new Set(["function", "class"]);

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

/** Runs Pass A (leaf semantics), Pass B (clustering), and Pass C (layer + system narration) over a structural snapshot, producing a fully-lifted scv/1 snapshot. Mirrors docs/mock/tools/build.py's interpret(). */
export async function runInterpreter(options: RunInterpreterOptions): Promise<Snapshot> {
  const { snapshot, graph, provider, promptRev, readSource, systemName } = options;
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
  const leafIds = snapshot.units.filter((u) => LEAF_KINDS.has(u.kind)).map((u) => u.id);
  const callEdgeRefs = graph.edges.filter((e) => e.kind === "calls").map((e) => ({ from: e.from, to: e.to }));
  const processingOrder = topoOrder(leafIds, callEdgeRefs);

  const knownOneLiners = new Map<string, string>();
  const passAResultById = new Map<string, Unit>();
  await runInDependencyOrder(processingOrder, PASS_A_CONCURRENCY, (id) => calleeIdsById.get(id) ?? [], async (id) => {
    const unit = snapshotUnitById.get(id)!;
    const symbolUnit = graphById.get(unit.id);
    if (!symbolUnit) {
      passAResultById.set(id, unit);
      return;
    }

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
  const blockLabelsByFunction = new Map<string, Map<string, string>>();
  await runInDependencyOrder(
    functionsWithBlocks.map((f) => f.unit.id),
    PASS_A_CONCURRENCY,
    () => [],
    async (unitId) => {
      const { unit, symbolUnit, bg } = functionsWithBlocks.find((f) => f.unit.id === unitId)!;
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
        name: labels?.get(block.id) ?? block.condition ?? block.blockType,
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
      });
    }
  }
  const unitsWithBlockChildren = units.map((unit) => {
    const childIds = blockChildrenByFunction.get(unit.id);
    if (!childIds) return unit;
    return { ...unit, children: [...unit.children, ...childIds] };
  });

  const unitsByFile = new Map<string, Unit[]>();
  for (const unit of unitsWithBlockChildren) {
    if (unit.kind !== "module") continue;
    for (const file of unit.loc.files) {
      (unitsByFile.get(file) ?? unitsByFile.set(file, []).get(file)!).push(unit);
    }
  }
  const files = [...unitsByFile.keys()];

  const leafUnitsByFile = new Map<string, Unit[]>();
  for (const unit of unitsWithBlockChildren) {
    if (!LEAF_KINDS.has(unit.kind)) continue;
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
    const key = `${fromFile} ${toFile}`;
    edgeWeightByFilePair.set(key, (edgeWeightByFilePair.get(key) ?? 0) + edge.weight);
  }
  for (const [key, weight] of edgeWeightByFilePair) {
    const [from, to] = key.split(" ") as [string, string];
    importEdges.push({ from, to, weight });
  }

  const passB = await runPassB({ files, oneLiners, edges: importEdges, provider, promptRev });

  const newUnits: Unit[] = [];
  const layerIds: string[] = [];
  const parentOverride = new Map<string, string>();

  for (const [, clusterFiles] of Object.entries(passB.clusters)) {
    const memberUnits = clusterFiles.flatMap((f) => unitsByFile.get(f) ?? []);
    if (memberUnits.length === 0) continue;
    const layerId = layerIdFor(clusterFiles);
    layerIds.push(layerId);
    for (const member of memberUnits) parentOverride.set(member.id, layerId);
  }

  const passC = await runPassC({ clusters: passB.clusters, oneLiners, provider, promptRev });

  // Layer-to-layer edge weights, rolled up the same way importEdges rolls up file-pair
  // weights above — one level higher, keyed by layer id via parentOverride — so the
  // grouping step sees which layers actually depend on each other, not just their names.
  const layerIdByName = new Map(passC.layers.map((l) => [l.name, layerIdFor(l.files)]));
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

  const passCGroups = await runPassCGroups({
    layers: passC.layers.map((l) => ({ name: l.name, why: l.why })),
    edges: groupEdges,
    provider,
    promptRev,
  });
  const groupByLayerName = new Map<string, string>();
  for (const [groupName, layerNames] of Object.entries(passCGroups.groups)) {
    for (const layerName of layerNames) groupByLayerName.set(layerName, groupName);
  }

  for (const layer of passC.layers) {
    const layerId = layerIdFor(layer.files);
    const memberUnits = layer.files.flatMap((f) => unitsByFile.get(f) ?? []);
    const memberIds = memberUnits.map((u) => u.id);
    if (memberIds.length === 0) continue;
    newUnits.push({
      id: layerId,
      kind: "layer",
      name: layer.name,
      qualname: layer.name,
      lang: undefined,
      parent: null,
      children: memberIds,
      group: groupByLayerName.get(layer.name),
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

  const callEdges: CallEdge[] = snapshot.edges.filter((e) => e.kind === "calls").map((e) => ({ from: e.from, to: e.to }));
  const flowUnitSummaries: FlowUnitSummary[] = units
    .filter((u) => LEAF_KINDS.has(u.kind))
    .map((u) => ({ id: u.id, qualname: u.qualname, what: u.semantics?.what ?? "" }));
  const unitById = new Map(units.map((u) => [u.id, u]));

  if (flowUnitSummaries.length > 0) {
    const entryPoints = await proposeFlowEntryPoints({ units: flowUnitSummaries, callEdges, provider, promptRev });
    const knownUnitIds = new Set(units.map((u) => u.id));

    for (const entry of entryPoints) {
      const steps = traceFlow(entry.unit, knownUnitIds, callEdges);
      if (!steps || steps.length < 2) continue;

      const stepUnits = steps.map((id) => unitById.get(id)).filter((u): u is Unit => Boolean(u));
      const narration = await narrateFlow({
        route: entry.route,
        name: entry.name,
        steps: stepUnits.map((u) => ({ qualname: u.qualname, what: u.semantics?.what ?? "" })),
        provider,
        promptRev,
      });

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

  const finalUnits = unitsWithBlockChildren.map((unit) => {
    const newParent = parentOverride.get(unit.id);
    if (newParent && unit.kind === "module") {
      return { ...unit, parent: newParent };
    }
    return unit;
  });

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
    const key = `${fromLayer} ${toLayer} ${edge.kind}`;
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

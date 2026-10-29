import { isGeneratedPath, isTestPath, type SymbolGraph } from "@scv/extractor";
import { runPassB, type ImportEdge } from "@scv/interpreter";
import type { PendingDoc, PendingFlow, PendingGroup, PendingLayer, PendingUnit, Snapshot, Unit } from "@scv/schema";
import { canonicalJson, graphHash, hashOf } from "./artifacts.js";
import type { DiscoveredDoc } from "./discover-docs.js";
import type { StoreContents } from "./semantics-store.js";

/**
 * Freshness fingerprints for the committed semantics store: sha-independent hashes of the inputs
 * an authored entry was written against, recomputable from a worktree alone. Unlike artifact
 * input hashes they exclude `promptRev`/`scopeKey`, which are runtime-cache concerns.
 */
const FINGERPRINT_VERSION = "fp1";

const NARRATED_KINDS = new Set(["function", "class"]);
const STRUCTURAL_KINDS = new Set(["module", "class", "function"]);

/** Strongly connected components of the call graph, callees before callers (Tarjan's emission
 *  order), computed iteratively so deep call chains cannot overflow the stack. */
function callSccs(graph: SymbolGraph): string[][] {
  const callees = new Map<string, string[]>(graph.units.map((u) => [u.id, []]));
  for (const edge of graph.edges) {
    if (edge.kind === "calls" && callees.has(edge.from) && callees.has(edge.to)) callees.get(edge.from)!.push(edge.to);
  }

  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let next = 0;

  for (const root of callees.keys()) {
    if (index.has(root)) continue;
    const work: [string, number][] = [[root, 0]];
    index.set(root, next);
    lowlink.set(root, next++);
    stack.push(root);
    onStack.add(root);

    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const [node, cursor] = frame;
      const out = callees.get(node)!;
      if (cursor < out.length) {
        frame[1]++;
        const target = out[cursor]!;
        if (!index.has(target)) {
          index.set(target, next);
          lowlink.set(target, next++);
          stack.push(target);
          onStack.add(target);
          work.push([target, 0]);
        } else if (onStack.has(target)) {
          lowlink.set(node, Math.min(lowlink.get(node)!, index.get(target)!));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) lowlink.set(parent[0], Math.min(lowlink.get(parent[0])!, lowlink.get(node)!));
      if (lowlink.get(node) === index.get(node)) {
        const scc: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          scc.push(member);
        } while (member !== node);
        sccs.push(scc);
      }
    }
  }
  return sccs;
}

/**
 * Fingerprints every function/class unit from what Pass A sees: its own `hash.struct` +
 * `hash.text`, its sorted caller and callee qualnames, and a digest of its direct callees'
 * committed semantics. Callees inside the unit's own call cycle are left out of the digest, so a
 * recursion cycle never invalidates itself.
 *
 * `committed(id, fingerprint)` returns the semantics a unit is committed with, given its freshly
 * computed fingerprint; units are visited callee-first, so each callee is resolved before any
 * caller's digest reads it.
 */
export function functionFingerprints(graph: SymbolGraph, committed: (id: string, fingerprint: string) => PendingUnit | undefined): Map<string, string> {
  const unitById = new Map(graph.units.map((u) => [u.id, u]));
  const qualname = (id: string) => unitById.get(id)?.qualname ?? id;
  const callers = new Map<string, Set<string>>();
  const callees = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (edge.kind !== "calls") continue;
    (callees.get(edge.from) ?? callees.set(edge.from, new Set()).get(edge.from)!).add(edge.to);
    (callers.get(edge.to) ?? callers.set(edge.to, new Set()).get(edge.to)!).add(edge.from);
  }

  const sccOf = new Map<string, number>();
  const sccs = callSccs(graph);
  sccs.forEach((scc, i) => scc.forEach((id) => sccOf.set(id, i)));

  const fingerprints = new Map<string, string>();
  const semanticsDigest = new Map<string, string>();
  for (const scc of sccs) {
    // Members of one cycle never read each other's digest, so every fingerprint in the SCC is
    // computed before any member is resolved.
    const members = scc.filter((id) => NARRATED_KINDS.has(unitById.get(id)!.kind)).sort();
    for (const id of members) {
      const unit = unitById.get(id)!;
      const sortedQualnames = (ids: Set<string> | undefined) => [...new Set([...(ids ?? [])].map(qualname))].sort().join("\n");
      const digest = [...(callees.get(id) ?? [])]
        .filter((callee) => semanticsDigest.has(callee) && sccOf.get(callee) !== sccOf.get(id))
        .map((callee) => `${qualname(callee)}:${semanticsDigest.get(callee)}`)
        .sort()
        .join("\n");
      fingerprints.set(id, hashOf(FINGERPRINT_VERSION, unit.hash.struct, unit.hash.text, sortedQualnames(callers.get(id)), sortedQualnames(callees.get(id)), digest));
    }
    for (const id of members) {
      semanticsDigest.set(id, hashOf(canonicalJson(committed(id, fingerprints.get(id)!) ?? null)));
    }
  }
  return fingerprints;
}

export function docFingerprint(path: string, content: string): string {
  return hashOf(FINGERPRINT_VERSION, path, content);
}

export interface Clusters {
  /** Real layer id → member files. */
  groups: Map<string, string[]>;
  /** Clustered source file → its module units. */
  unitsByFile: Map<string, Unit[]>;
  modularity: number;
  directoryModularity: number;
}

/** Deterministic Pass B over a structural snapshot's module units and file-level import weights. */
export function computeClusters(units: Unit[], edges: Snapshot["edges"]): Clusters {
  const unitsByFile = new Map<string, Unit[]>();
  for (const unit of units) {
    if (unit.kind !== "module") continue;
    const file = unit.loc.files[0];
    if (!file || isTestPath(file) || isGeneratedPath(file)) continue;
    (unitsByFile.get(file) ?? unitsByFile.set(file, []).get(file)!).push(unit);
  }

  const fileOfUnit = new Map<string, string>();
  for (const unit of units) {
    if (unit.loc.files[0]) fileOfUnit.set(unit.id, unit.loc.files[0]);
  }
  const weightByFilePair = new Map<string, number>();
  for (const edge of edges) {
    const fromFile = fileOfUnit.get(edge.from);
    const toFile = fileOfUnit.get(edge.to);
    if (!fromFile || !toFile || fromFile === toFile) continue;
    const key = `${fromFile} ${toFile}`;
    weightByFilePair.set(key, (weightByFilePair.get(key) ?? 0) + edge.weight);
  }
  const importEdges: ImportEdge[] = [...weightByFilePair].map(([key, weight]) => {
    const [from, to] = key.split(" ") as [string, string];
    return { from, to, weight };
  });

  const passB = runPassB({ files: [...unitsByFile.keys()], edges: importEdges });
  return { groups: passB.groups, unitsByFile, modularity: passB.modularity, directoryModularity: passB.directoryModularity };
}

/** An authored entry plus the fingerprint it was stamped with; absent means "authored now", which
 *  is fresh by definition and gets stamped with the current inputs. */
export interface Stamped<T> {
  fingerprint?: string;
  entry: T;
}

export interface AuthoredSet {
  functions: Record<string, Stamped<PendingUnit>>;
  docs: Record<string, Stamped<PendingDoc>>;
  layers?: Stamped<Record<string, PendingLayer>>;
  groups?: Stamped<Record<string, PendingGroup>>;
  flows?: Stamped<Record<string, PendingFlow>>;
}

export function emptyAuthoredSet(): AuthoredSet {
  return { functions: {}, docs: {} };
}

/** The store as an `AuthoredSet`: function shards flattened by unit id, fingerprints split out. */
export function authoredFromStore(store: StoreContents): AuthoredSet {
  const functions: AuthoredSet["functions"] = {};
  for (const units of Object.values(store.functions)) {
    for (const [id, { fingerprint, ...entry }] of Object.entries(units)) functions[id] = { fingerprint, entry };
  }
  const docs: AuthoredSet["docs"] = {};
  for (const [path, { fingerprint, ...entry }] of Object.entries(store.docs)) docs[path] = { fingerprint, entry };
  return {
    functions,
    docs,
    layers: store.layers && { fingerprint: store.layers.fingerprint, entry: store.layers.layers },
    groups: store.groups && { fingerprint: store.groups.fingerprint, entry: store.groups.groups },
    flows: store.flows && { fingerprint: store.flows.fingerprint, entry: store.flows.flows },
  };
}

/**
 * Freshness of one item against the current inputs. `primary` is a fresh entry from the local
 * authoring record, if any; `store` is the committed entry, fresh or not. The committed view an
 * export would produce is `primary ?? store`.
 */
export interface Choice<T> {
  fingerprint: string;
  primary?: T;
  store?: Stamped<T> & { fingerprint: string };
  storeFresh: boolean;
}

export function committedView<T>(choice: Choice<T> | undefined): T | undefined {
  return choice?.primary ?? choice?.store?.entry;
}

export interface Evaluation {
  functions: Map<string, Choice<PendingUnit>>;
  docs: Map<string, Choice<PendingDoc>>;
  layers: Choice<Record<string, PendingLayer>>;
  groups: Choice<Record<string, PendingGroup>>;
  flows: Choice<Record<string, PendingFlow>>;
}

export interface FingerprintInputs {
  graph: SymbolGraph;
  snapshot: Snapshot;
  docs: DiscoveredDoc[];
}

function choose<T>(fingerprint: string, primary: Stamped<T> | undefined, store: Stamped<T> | undefined): Choice<T> {
  const primaryFresh = primary !== undefined && (primary.fingerprint ?? fingerprint) === fingerprint;
  return {
    fingerprint,
    primary: primaryFresh ? primary.entry : undefined,
    store: store?.fingerprint === undefined ? undefined : { fingerprint: store.fingerprint, entry: store.entry },
    storeFresh: store?.fingerprint === fingerprint,
  };
}

/**
 * Recomputes every fingerprint for the current inputs and pairs it with the authored entries.
 * Downstream fingerprints read the committed view of upstream narration (callee semantics →
 * callers; functions and docs → layers; layers → groups; functions → flows), so re-authoring
 * upstream newly invalidates what was written against the old text. One function serves
 * merge-time stamping, export, hydrate and check, so all of them agree on freshness.
 */
export function evaluate(inputs: FingerprintInputs, primary: AuthoredSet, store: AuthoredSet): Evaluation {
  const { graph, snapshot } = inputs;

  const functions = new Map<string, Choice<PendingUnit>>();
  functionFingerprints(graph, (id, fingerprint) => {
    const choice = choose(fingerprint, primary.functions[id], store.functions[id]);
    functions.set(id, choice);
    return committedView(choice);
  });

  const docs = new Map<string, Choice<PendingDoc>>();
  for (const doc of [...inputs.docs].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    docs.set(doc.path, choose(docFingerprint(doc.path, doc.content), primary.docs[doc.path], store.docs[doc.path]));
  }

  const structuralUnits = snapshot.units.filter((u) => STRUCTURAL_KINDS.has(u.kind));
  const unitNarration = structuralUnits.map((u) => `${u.id}:${committedView(functions.get(u.id))?.semantics?.what ?? ""}`).join("\n");
  const clusters = computeClusters(structuralUnits, snapshot.edges);
  const clusterEntries = [...clusters.groups];

  const layersFingerprint = hashOf(
    FINGERPRINT_VERSION,
    clusterEntries.map(([id, files]) => `${id}:${files.join(",")}`).join("\n"),
    canonicalJson([...clusters.unitsByFile].map(([file, units]) => [file, units.map((u) => u.id)])),
    [...docs].map(([path, choice]) => `${path}:${canonicalJson(committedView(choice) ?? null)}`).join("\n"),
    unitNarration,
  );
  const layers = choose(layersFingerprint, primary.layers, store.layers);

  const layerView = committedView(layers) ?? {};
  const layerSummaries = clusterEntries
    .filter(([, files]) => files.some((file) => (clusters.unitsByFile.get(file) ?? []).length > 0))
    .map(([id]) => `${id}:${layerView[id]?.name ?? id}:${layerView[id]?.why ?? "(no summary)"}`);
  const edges = snapshot.edges.map((e) => `${e.from}>${e.to}`).join("\n");
  const groups = choose(hashOf(FINGERPRINT_VERSION, layerSummaries.join("\n"), edges), primary.groups, store.groups);

  const flows = choose(hashOf(FINGERPRINT_VERSION, unitNarration, graphHash(graph)), primary.flows, store.flows);

  return { functions, docs, layers, groups, flows };
}

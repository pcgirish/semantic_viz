import { z } from "zod";
import type { Provider } from "./provider.js";
import { passCPrompt } from "./prompts/pass-c.js";
import { passCEntryPointsPrompt, passCFlowNarrationPrompt } from "./prompts/pass-c-flows.js";
import type { FlowStepSummary, FlowUnitSummary, StructuralRouteHint } from "./prompts/pass-c-flows.js";
import { passCGroupsPrompt } from "./prompts/pass-c-groups.js";
import type { CallEdge, ClusterProposal, ImportEdge } from "./checker.js";
import type { ClusterGroups } from "./cluster.js";
import { interpretJsonWithRetry } from "./retry.js";

const PassCResponseSchema = z.object({
  name: z.string().min(1).max(40),
  what: z.string(),
  how: z.string(),
  when: z.string(),
  where: z.string(),
  why: z.string(),
  confidence: z.number().min(0).max(1),
});

export interface Layer {
  name: string;
  files: string[];
  what: string;
  how: string;
  when: string;
  where: string;
  why: string;
  confidence: number;
  source: "llm";
}

export interface PassCResult {
  layers: Layer[];
}

export interface RunPassCOptions {
  /** Membership keyed by structural id — names do not exist until Pass C answers. */
  groups: ClusterGroups;
  oneLiners: Record<string, string>;
  provider: Provider;
  promptRev: string;
  repoContext?: string;
  /** Layers from the nearest ancestor analysis, keyed by structural id. A hit means identical
   *  membership (the id *is* the membership hash), so the whole record is reused and no call
   *  is made for that cluster. */
  previousLayers?: Map<string, Layer>;
}

/**
 * Pass C — names and narrates each cluster. One LLM call per cluster *without* a predecessor:
 * a cluster whose id matches a previous run's has identical membership by construction, so its
 * entire record — name and all five narration fields — is carried over verbatim. That is what
 * makes "unchanged membership ⇒ byte-identical layer" hold, and it cuts calls on re-analysis.
 *
 * Clusters are visited in ascending structural-id order, so the order names are assigned in is
 * itself deterministic. See analyze.md#2.
 */
export async function runPassC(options: RunPassCOptions): Promise<PassCResult> {
  const { groups, oneLiners, provider, repoContext, previousLayers } = options;
  const layers: Layer[] = [];

  for (const [layerId, files] of groups) {
    const previous = previousLayers?.get(layerId);
    if (previous) {
      layers.push({ ...previous, files: [...files] });
      continue;
    }

    const prompt = passCPrompt({ layerId, files, oneLiners, repoContext });
    const response = await interpretJsonWithRetry({
      provider,
      prompt,
      label: `pass C: cluster ${layerId}`,
      schema: PassCResponseSchema,
      context: { callMeta: { pass: "C" } },
    });
    layers.push({
      name: response.name,
      files: [...files],
      what: response.what,
      how: response.how,
      when: response.when,
      where: response.where,
      why: response.why,
      confidence: response.confidence,
      source: "llm",
    });
  }

  return { layers };
}

const MergesMapSchema = z.record(z.string(), z.array(z.string()));

function isMergesWrapped(value: Record<string, string[]> | { merges: Record<string, string[]> }): value is {
  merges: Record<string, string[]>;
} {
  return "merges" in value && !Array.isArray(value.merges) && typeof value.merges === "object";
}

// Mirrors Pass B's response-shape tolerance: some local models drop the "merges" wrapper.
const PassCGroupsResponseSchema = z
  .union([z.object({ merges: MergesMapSchema }), MergesMapSchema])
  .transform((value) => (isMergesWrapped(value) ? value : { merges: value }));

export interface PassCGroupsResult {
  groups: ClusterProposal;
  repaired: boolean;
}

export interface RunPassCGroupsOptions {
  layers: { name: string; why: string }[];
  edges: ImportEdge[];
  provider: Provider;
  promptRev: string;
  repoContext?: string;
}

/**
 * Applies layer merges to the base singleton partition: layers listed in merges
 * are combined with the merge's name; unlisted layers stay as singletons under their own name.
 * Parallel to checkAndRepairClusters but for layer names instead of files.
 */
function applyLayerMerges(layerNames: string[], merges: Record<string, string[]>): { proposal: ClusterProposal; repaired: boolean } {
  const allLayers = new Set(layerNames);
  const proposal: ClusterProposal = {};
  let repaired = false;

  const seenLayers = new Set<string>();

  for (const [mergeName, layers] of Object.entries(merges)) {
    const mergedLayers: string[] = [];
    for (const layer of layers) {
      if (!allLayers.has(layer)) {
        repaired = true;
        continue;
      }
      if (seenLayers.has(layer)) {
        repaired = true;
        continue;
      }
      seenLayers.add(layer);
      mergedLayers.push(layer);
    }
    if (mergedLayers.length === 0) {
      if (layers.length > 0) repaired = true;
      continue;
    }
    // A merge name identical to a layer left unmerged would silently clobber that layer's
    // own singleton entry below (both use the same proposal key); identical to one of its
    // own merged members reads as that layer nesting inside itself once rendered — rename
    // the merge in either case rather than losing data or rendering a self-nested group.
    let name = mergeName;
    if ((allLayers.has(name) && !seenLayers.has(name)) || mergedLayers.includes(name)) {
      repaired = true;
      name = `${mergeName}_group`;
    }
    proposal[name] = mergedLayers;
  }

  // Singleton groups for layers not mentioned in any merge
  for (const layer of allLayers) {
    if (!seenLayers.has(layer)) {
      proposal[layer] = [layer];
    }
  }

  return { proposal, repaired };
}

/**
 * Pass C — groups. Merges Pass C's layers into named architectural groups via LLM-proposed
 * merges of the base layer partition. Unlisted layers stay as singleton groups.
 */
export async function runPassCGroups(options: RunPassCGroupsOptions): Promise<PassCGroupsResult> {
  const { layers, edges, provider, repoContext } = options;
  const layerNames = layers.map((l) => l.name);
  const prompt = passCGroupsPrompt(layers, edges, repoContext);
  const response = await interpretJsonWithRetry({
    provider,
    prompt,
    label: "pass C: groups",
    schema: PassCGroupsResponseSchema,
    context: { callMeta: { pass: "C" } },
  });

  const { proposal, repaired } = applyLayerMerges(layerNames, response.merges);

  return { groups: proposal, repaired };
}

const EntryPointSchema = z.object({ unit: z.string(), name: z.string(), route: z.string() });
const EntryPointsResponseSchema = z.object({ flows: z.array(EntryPointSchema) });

export interface FlowEntryPoint {
  unit: string;
  name: string;
  route: string;
}

export interface ProposeFlowEntryPointsOptions {
  units: FlowUnitSummary[];
  callEdges: CallEdge[];
  provider: Provider;
  promptRev: string;
  /** Structurally-detected route handlers (from SymbolGraph.routes), hinted to the LLM to
   *  reduce sampling variance on the route-handler subset of entry points. */
  routeHints?: StructuralRouteHint[];
}

/**
 * Pass C — proposes api_flow entry points in one call, mirroring Pass B's
 * propose-then-repair split: the LLM proposes freely, then any unit id it didn't actually
 * see gets dropped rather than trusted (same repair discipline as checkAndRepairClusters).
 */
export async function proposeFlowEntryPoints(options: ProposeFlowEntryPointsOptions): Promise<FlowEntryPoint[]> {
  const { units, callEdges, provider, routeHints = [] } = options;
  const prompt = passCEntryPointsPrompt(units, callEdges, routeHints);
  const response = await interpretJsonWithRetry({
    provider,
    prompt,
    label: "pass C: flow entry points",
    schema: EntryPointsResponseSchema,
    context: { callMeta: { pass: "C" } },
  });

  const knownIds = new Set(units.map((u) => u.id));
  return response.flows.filter((f) => knownIds.has(f.unit));
}

const FlowNarrationResponseSchema = z.object({
  what: z.string(),
  how: z.string(),
  when: z.string(),
  where: z.string(),
  why: z.string(),
  tags: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export interface FlowNarration {
  what: string;
  how: string;
  when: string;
  where: string;
  why: string;
  tags: string[];
  confidence: number;
  source: "llm";
}

export interface NarrateFlowOptions {
  route: string;
  name: string;
  steps: FlowStepSummary[];
  provider: Provider;
  promptRev: string;
}

/** Pass C — narrates a traced flow's steps (real graph edges, not LLM-authored) into what/how/when/where/why. */
export async function narrateFlow(options: NarrateFlowOptions): Promise<FlowNarration> {
  const { route, name, steps, provider } = options;
  const prompt = passCFlowNarrationPrompt(route, name, steps);
  const response = await interpretJsonWithRetry({
    provider,
    prompt,
    label: `pass C: flow "${name}"`,
    schema: FlowNarrationResponseSchema,
    context: { callMeta: { pass: "C" } },
  });

  return { ...response, source: "llm" };
}

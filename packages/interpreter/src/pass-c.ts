import { z } from "zod";
import type { Provider } from "./provider.js";
import { passCPrompt } from "./prompts/pass-c.js";
import { passCEntryPointsPrompt, passCFlowNarrationPrompt } from "./prompts/pass-c-flows.js";
import type { FlowStepSummary, FlowUnitSummary } from "./prompts/pass-c-flows.js";
import { passCGroupsPrompt } from "./prompts/pass-c-groups.js";
import { checkAndRepairClusters } from "./checker.js";
import type { CallEdge, ClusterProposal, ImportEdge } from "./checker.js";
import { interpretJsonWithRetry } from "./retry.js";

const PassCResponseSchema = z.object({
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
  clusters: ClusterProposal;
  oneLiners: Record<string, string>;
  provider: Provider;
  promptRev: string;
}

/** Pass C — architecture narration. One LLM call per Pass B cluster, producing a layer's `why`. See analyze.md#2. */
export async function runPassC(options: RunPassCOptions): Promise<PassCResult> {
  const { clusters, oneLiners, provider } = options;
  const layers: Layer[] = [];

  for (const [name, files] of Object.entries(clusters)) {
    const prompt = passCPrompt(name, files, oneLiners);
    const response = await interpretJsonWithRetry({
      provider,
      prompt,
      label: `pass C: cluster "${name}"`,
      schema: PassCResponseSchema,
    });
    layers.push({
      name,
      files,
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

const GroupMapSchema = z.record(z.string(), z.array(z.string()));

function isGroupsWrapped(value: Record<string, string[]> | { groups: Record<string, string[]> }): value is {
  groups: Record<string, string[]>;
} {
  return "groups" in value && !Array.isArray(value.groups) && typeof value.groups === "object";
}

// Mirrors Pass B's response-shape tolerance: some local models drop the "groups" wrapper.
const PassCGroupsResponseSchema = z
  .union([z.object({ groups: GroupMapSchema }), GroupMapSchema])
  .transform((value) => (isGroupsWrapped(value) ? value : { groups: value }));

export interface PassCGroupsResult {
  groups: ClusterProposal;
  repaired: boolean;
}

export interface RunPassCGroupsOptions {
  layers: { name: string; why: string }[];
  edges: ImportEdge[];
  provider: Provider;
  promptRev: string;
}

/**
 * Pass C — groups. Super-groups Pass C's layers into a small number of named
 * architectural groups (e.g. "api surface", "platform"), one level above `layer`. Same
 * propose-then-repair discipline as Pass B: the LLM proposes freely, the deterministic
 * checker guarantees every layer lands in exactly one group.
 */
export async function runPassCGroups(options: RunPassCGroupsOptions): Promise<PassCGroupsResult> {
  const { layers, edges, provider } = options;
  const layerNames = layers.map((l) => l.name);
  const prompt = passCGroupsPrompt(layers, edges);
  const response = await interpretJsonWithRetry({
    provider,
    prompt,
    label: "pass C: groups",
    schema: PassCGroupsResponseSchema,
  });
  const { clusters, repaired } = checkAndRepairClusters(response.groups, layerNames);

  return { groups: clusters, repaired };
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
}

/**
 * Pass C — proposes api_flow entry points in one call, mirroring Pass B's
 * propose-then-repair split: the LLM proposes freely, then any unit id it didn't actually
 * see gets dropped rather than trusted (same repair discipline as checkAndRepairClusters).
 */
export async function proposeFlowEntryPoints(options: ProposeFlowEntryPointsOptions): Promise<FlowEntryPoint[]> {
  const { units, callEdges, provider } = options;
  const prompt = passCEntryPointsPrompt(units, callEdges);
  const response = await interpretJsonWithRetry({
    provider,
    prompt,
    label: "pass C: flow entry points",
    schema: EntryPointsResponseSchema,
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
  });

  return { ...response, source: "llm" };
}

/**
 * Schema for agent-authored semantics staged for `scv merge-semantics`. An agent that already
 * has full context of code it wrote or read populates this file with Pass-A/Pass-C-shaped
 * fields directly — no LLM/provider call — and the merge command injects it into the artifact
 * cache as if a real interpreter pass had produced it.
 */
import { z } from "zod";

const PendingSemanticsFieldsSchema = z.object({
  what: z.string(),
  how: z.string(),
  when: z.string(),
  where: z.string(),
  why: z.string(),
  confidence: z.number().min(0).max(1),
});

const PendingPortSchema = z.object({
  name: z.string(),
  type: z.string().nullable(),
  description: z.string().optional(),
});

const PendingSignatureSchema = z.object({
  in: z.array(PendingPortSchema),
  out: z.array(PendingPortSchema),
  raises: z.array(z.string()),
  async: z.boolean(),
});

const PendingCostSchema = z.object({
  complexity: z.number().optional(),
  io: z.array(z.string()).optional(),
  estimate: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

/**
 * A readable name for one control-flow block, replacing the structural fallback the builder
 * derives from `blockType`/`condition`. `trueLabel`/`falseLabel` name the outgoing branch edges
 * of a decision block.
 *
 * Keys are the extractor's readable `blockId` — "decision:0", "loop:1" — scoped to the owning
 * function, which is what makes these hand-authorable. That id is not persisted verbatim
 * (`resolveBlockGraph` hashes it into `u:block:<hash>`), so the merge reconstructs it from the
 * per-function block order; the hashed `u:block:<hash>` form is accepted too, for callers reading
 * ids straight out of `extraction.json`.
 *
 * Lengths are capped because these render as flowchart node/edge text: a label that overflows its
 * node is worse than the structural fallback it replaces.
 */
export const PendingBlockLabelSchema = z.object({
  label: z.string().min(1).max(60),
  trueLabel: z.string().min(1).max(24).optional(),
  falseLabel: z.string().min(1).max(24).optional(),
});

export const PendingUnitSchema = z.object({
  kind: z.enum(["function", "class"]),
  semantics: PendingSemanticsFieldsSchema.optional(),
  cost: PendingCostSchema.optional(),
  tags: z.array(z.string()).optional(),
  signature: PendingSignatureSchema.optional(),
  /** Control-flow block labels for this function, keyed by readable `blockId` ("decision:0"). */
  blockLabels: z.record(z.string(), PendingBlockLabelSchema).optional(),
});

export const PendingLayerSchema = PendingSemanticsFieldsSchema.extend({
  name: z.string().min(1).max(40),
  files: z.array(z.string()).min(1),
});

/**
 * A pending group's key is an arbitrary agent-chosen label, not the real group id — that is
 * derived from a hash of the resolved member layer ids and cannot be known before membership
 * resolves. `layers` holds layer *names*, resolved to ids at merge time.
 *
 * Unlike the real Pass C pipeline (which ships groups with `semantics: null` until a real
 * group-narration pass lands), the agent-authored path carries narration fields.
 */
export const PendingGroupSchema = PendingSemanticsFieldsSchema.extend({
  name: z.string().min(1).max(40),
  layers: z.array(z.string()).min(1),
});

/** `entryUnit` is the unit id of the entry-point function; tracing from it is deterministic. */
export const PendingFlowSchema = PendingSemanticsFieldsSchema.extend({
  name: z.string().min(1),
  route: z.string().min(1),
  entryUnit: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

/** One agent-authored doc extract, mirroring the interpreter's `DocExtract` exactly. `path` must
 *  name a doc the CLI actually discovered — see `mergeDocs`. */
export const PendingDocSchema = z.object({
  path: z.string().min(1),
  purpose: z.string(),
  modules: z
    .array(z.object({ name: z.string(), description: z.string(), paths: z.array(z.string()).default([]) }))
    .default([]),
  architecture_notes: z.array(z.string()).default([]),
});


export const PendingSemanticsSchema = z.object({
  meta: z
    .object({
      createdAt: z.string().optional(),
      // Self-identify the authoring agent here, e.g. "agent-analyze-functions" — merged
      // units get provenance.source: "manual", not "llm", since no provider call produced them.
      agent: z.string().optional(),
      scope: z.string().optional(),
    })
    .optional(),
  units: z.record(z.string(), PendingUnitSchema).default({}),
  layers: z.record(z.string(), PendingLayerSchema).default({}),
  groups: z.record(z.string(), PendingGroupSchema).default({}),
  flows: z.record(z.string(), PendingFlowSchema).default({}),
  docs: z.record(z.string(), PendingDocSchema).default({}),
});

export type PendingDoc = z.infer<typeof PendingDocSchema>;
export type PendingBlockLabel = z.infer<typeof PendingBlockLabelSchema>;
export type PendingUnit = z.infer<typeof PendingUnitSchema>;
export type PendingLayer = z.infer<typeof PendingLayerSchema>;
export type PendingGroup = z.infer<typeof PendingGroupSchema>;
export type PendingFlow = z.infer<typeof PendingFlowSchema>;
export type PendingSemantics = z.infer<typeof PendingSemanticsSchema>;

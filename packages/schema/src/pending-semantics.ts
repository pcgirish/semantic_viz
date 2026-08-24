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

export const PendingUnitSchema = z.object({
  kind: z.enum(["function", "class"]),
  semantics: PendingSemanticsFieldsSchema.optional(),
  cost: PendingCostSchema.optional(),
  tags: z.array(z.string()).optional(),
  signature: PendingSignatureSchema.optional(),
});

export const PendingLayerSchema = PendingSemanticsFieldsSchema.extend({
  name: z.string().min(1).max(40),
  files: z.array(z.string()).min(1),
});

export const PendingSemanticsSchema = z.object({
  meta: z
    .object({
      createdAt: z.string().optional(),
      agent: z.string().optional(),
      scope: z.string().optional(),
    })
    .optional(),
  units: z.record(z.string(), PendingUnitSchema).default({}),
  layers: z.record(z.string(), PendingLayerSchema).default({}),
});

export type PendingUnit = z.infer<typeof PendingUnitSchema>;
export type PendingLayer = z.infer<typeof PendingLayerSchema>;
export type PendingSemantics = z.infer<typeof PendingSemanticsSchema>;

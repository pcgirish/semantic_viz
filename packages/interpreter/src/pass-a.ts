import { z } from "zod";
import type { SymbolUnit } from "@scv/extractor";
import type { Provider } from "./provider.js";
import { passAPrompt } from "./prompts/pass-a.js";
import { interpretJsonWithRetry } from "./retry.js";

const PortSchema = z.object({
  name: z.string(),
  type: z.string().nullable().optional(),
  description: z.string().optional(),
});

const PassAResponseSchema = z.object({
  what: z.string(),
  how: z.string(),
  when: z.string(),
  where: z.string(),
  why: z.string(),
  confidence: z.number().min(0).max(1),
  ports: z.object({ in: z.array(PortSchema), out: z.array(PortSchema) }),
  cost: z.object({
    complexity: z.number(),
    io: z.array(z.string()),
    estimate: z.string(),
    confidence: z.number().min(0).max(1),
  }),
  tags: z.array(z.string()),
});

export interface PassAResult {
  semantics: {
    what: string;
    how: string;
    when: string;
    where: string;
    why: string;
    confidence: number;
    source: "llm";
  };
  cost: {
    complexity: number;
    io: string[];
    estimate: string;
    confidence: number;
    source: "llm";
  };
  tags: string[];
}

export interface RunPassAOptions {
  unit: SymbolUnit;
  source: string;
  provider: Provider;
  promptRev: string;
  /** Qualnames of units that call / are called by this unit, from the static call graph. */
  callers?: string[];
  callees?: string[];
  /** Callee qualname -> already-known one-liner (`.semantics.what`), free with bottom-up ordering. */
  knownCalleeOneLiners?: Map<string, string>;
  /**
   * Digest of this unit's callees' semantic hashes. Not sent to the model — folded into the
   * cache key so a callee's semantics changing invalidates this unit's cache entry even when
   * the callee wasn't ready in time to be inlined into the prompt text itself (see
   * knownCalleeOneLiners).
   */
  calleeSemanticsDigest?: string;
}

/** Pass A — leaf semantics for one function or class. See analyze.md#2. */
export async function runPassA(options: RunPassAOptions): Promise<PassAResult> {
  const { unit, source, provider, callers = [], callees = [], knownCalleeOneLiners = new Map(), calleeSemanticsDigest } = options;
  const prompt = passAPrompt(unit, source, callers, callees, knownCalleeOneLiners);
  const response = await interpretJsonWithRetry({
    provider,
    prompt,
    label: `pass A: ${unit.qualname}`,
    schema: PassAResponseSchema,
    context: {
      ...(calleeSemanticsDigest ? { cacheKeyExtra: calleeSemanticsDigest } : {}),
      callMeta: { pass: "A", unitId: unit.id, qualname: unit.qualname, file: unit.loc.file },
    },
  });

  return {
    semantics: {
      what: response.what,
      how: response.how,
      when: response.when,
      where: response.where,
      why: response.why,
      confidence: response.confidence,
      source: "llm",
    },
    cost: {
      complexity: response.cost.complexity,
      io: response.cost.io,
      estimate: response.cost.estimate,
      confidence: response.cost.confidence,
      source: "llm",
    },
    tags: response.tags,
  };
}

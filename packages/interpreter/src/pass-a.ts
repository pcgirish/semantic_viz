import { z } from "zod";
import type { SymbolUnit } from "@scv/extractor";
import type { Provider } from "./provider.js";
import { passAPrompt } from "./prompts/pass-a.js";

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

/** Strips a ```json ... ``` (or bare ```) fence some models wrap JSON in despite instructions not to. */
function stripCodeFence(text: string): string {
  const match = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/.exec(text.trim());
  return match ? match[1]! : text;
}

export interface RunPassAOptions {
  unit: SymbolUnit;
  source: string;
  provider: Provider;
  promptRev: string;
}

/** Pass A — leaf semantics for one function or class. See analyze.md#2. */
export async function runPassA(options: RunPassAOptions): Promise<PassAResult> {
  const { unit, source, provider } = options;
  const prompt = passAPrompt(unit, source);
  const { text } = await provider.interpret(prompt);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    throw new Error(`pass A: provider returned non-JSON output for ${unit.qualname}: ${text.slice(0, 200)}`);
  }

  const response = PassAResponseSchema.parse(parsed);

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

import { z } from "zod";
import type { Provider } from "./provider.js";
import { passDocsPrompt } from "./prompts/pass-docs.js";
import { interpretJsonWithRetry } from "./retry.js";

const ModuleHintSchema = z.object({
  name: z.string(),
  description: z.string(),
  paths: z.array(z.string()),
});

const PassDocsResponseSchema = z.object({
  purpose: z.string(),
  modules: z.array(ModuleHintSchema),
  architecture_notes: z.array(z.string()),
});

export interface DocInput {
  path: string;
  content: string;
}

export interface DocExtract {
  path: string;
  purpose: string;
  modules: { name: string; description: string; paths: string[] }[];
  architecture_notes: string[];
}

export interface RunPassDocsOptions {
  docs: DocInput[];
  provider: Provider;
  promptRev: string;
}

/** Pass Docs — extracts clustering-relevant structure from repo docs, one call per doc. See analyze.md#2. */
export async function runPassDocs(options: RunPassDocsOptions): Promise<DocExtract[]> {
  const { docs, provider } = options;

  return Promise.all(
    docs.map(async (doc) => {
      const prompt = passDocsPrompt(doc.path, doc.content);
      const response = await interpretJsonWithRetry({
        provider,
        prompt,
        label: "pass docs",
        schema: PassDocsResponseSchema,
        context: { callMeta: { pass: "Docs", file: doc.path } },
      });

      return { path: doc.path, ...response };
    }),
  );
}

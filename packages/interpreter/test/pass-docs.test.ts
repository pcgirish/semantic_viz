import { describe, expect, it, vi } from "vitest";
import { runPassDocs } from "../src/pass-docs.js";
import type { Provider, ProviderResult } from "../src/provider.js";

function fakeProvider(responses: object[]): Provider {
  let call = 0;
  return {
    name: "fake",
    model: "fake-model",
    interpret: vi.fn(async (): Promise<ProviderResult> => ({ text: JSON.stringify(responses[call++]), tokens: 10 })),
  };
}

const structuredResponse = {
  purpose: "A FastAPI service for order management.",
  modules: [{ name: "api", description: "HTTP route handlers", paths: ["src/api"] }],
  architecture_notes: ["Routes call into repo, which talks to the db."],
};

const emptyResponse = {
  purpose: "Contribution guidelines.",
  modules: [],
  architecture_notes: [],
};

describe("runPassDocs", () => {
  it("makes one provider call per doc and returns structured extracts", async () => {
    const provider = fakeProvider([structuredResponse, emptyResponse]);
    const docs = [
      { path: "README.md", content: "# Orderly\n\nA FastAPI service." },
      { path: "CONTRIBUTING.md", content: "Run npm test before submitting." },
    ];

    const result = await runPassDocs({ docs, provider, promptRev: "p1" });

    expect(provider.interpret).toHaveBeenCalledTimes(2);
    expect(result).toEqual([
      { path: "README.md", ...structuredResponse },
      { path: "CONTRIBUTING.md", ...emptyResponse },
    ]);
  });

  it("treats a doc with empty modules/architecture_notes as a valid, non-error result", async () => {
    const provider = fakeProvider([emptyResponse]);
    const docs = [{ path: "CONTRIBUTING.md", content: "Run npm test before submitting." }];

    const result = await runPassDocs({ docs, provider, promptRev: "p1" });

    expect(result).toEqual([{ path: "CONTRIBUTING.md", ...emptyResponse }]);
  });

  it("returns an empty array for an empty docs list without calling the provider", async () => {
    const provider = fakeProvider([]);

    const result = await runPassDocs({ docs: [], provider, promptRev: "p1" });

    expect(result).toEqual([]);
    expect(provider.interpret).not.toHaveBeenCalled();
  });

  it("throws a clear error when the provider returns invalid JSON", async () => {
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async () => ({ text: "not json", tokens: 1 })),
    };
    const docs = [{ path: "README.md", content: "some content" }];

    await expect(runPassDocs({ docs, provider, promptRev: "p1" })).rejects.toThrow(/pass docs/i);
  });
});

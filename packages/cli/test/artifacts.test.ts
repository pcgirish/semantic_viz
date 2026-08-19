import { mkdtempSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractRepo } from "@scv/extractor";
import type { Provider, ProviderResult } from "@scv/interpreter";
import { toSnapshot } from "../src/snapshot.js";
import { ensureArtifact, type ArtifactContext } from "../src/artifacts.js";

const orderlyRoot = fileURLToPath(new URL("../../../fixtures/orderly", import.meta.url));

const passAResponse = {
  what: "does a thing",
  how: "by doing it",
  when: "on call",
  where: "backend",
  why: "needed",
  confidence: 0.9,
  ports: { in: [], out: [] },
  cost: { complexity: 1, io: [], estimate: "fast", confidence: 0.9 },
  tags: [],
};

function fakeProvider(): Provider {
  return {
    name: "fake",
    model: "fake-model",
    interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
      if (prompt.includes("extracting structural signal")) {
        const match = /Content:\n```\n([\s\S]*?)\n```/.exec(prompt);
        return { text: JSON.stringify({ purpose: match?.[1] ?? "", modules: [], architecture_notes: [] }), tokens: 10 };
      }
      if (prompt.includes("grouping the files")) {
        return { text: JSON.stringify({ clusters: { misc: [] } }), tokens: 10 };
      }
      if (prompt.includes("describing why")) {
        return {
          text: JSON.stringify({ what: "misc what", how: "misc how", when: "misc when", where: "misc where", why: "misc layer", confidence: 0.5 }),
          tokens: 10,
        };
      }
      if (prompt.includes("grouping a codebase's architectural layers")) {
        return { text: JSON.stringify({ groups: { platform: ["misc", "unclustered"] } }), tokens: 10 };
      }
      if (prompt.includes("identifying api_flow")) {
        return { text: JSON.stringify({ flows: [] }), tokens: 10 };
      }
      if (prompt.includes("labeling the control-flow blocks")) {
        const ids = [...prompt.matchAll(/- id: (\S+)/g)].map((m) => m[1]);
        return { text: JSON.stringify({ labels: ids.map((blockId) => ({ blockId, label: "step" })) }), tokens: 10 };
      }
      return { text: JSON.stringify(passAResponse), tokens: 10 };
    }),
  };
}

function readSource(root: string) {
  return (file: string, start: number, end: number): string => {
    const lines = readFileSync(path.join(root, file), "utf-8").split("\n");
    return lines.slice(start - 1, end).join("\n");
  };
}

describe("ensureArtifact", () => {
  let scvDir: string;

  beforeEach(() => {
    scvDir = mkdtempSync(path.join(tmpdir(), "scv-artifacts-"));
  });

  afterEach(() => {
    rmSync(scvDir, { recursive: true, force: true });
  });

  function makeCtx(provider: Provider, docs: { path: string; content: string }[], force?: ArtifactContext["force"]): ArtifactContext {
    const graph = extractRepo(orderlyRoot);
    const snapshot = toSnapshot(graph, { root: orderlyRoot, rev: { sha: "fixed-sha", kind: "commit", ts: "2020-01-01T00:00:00Z", author: "test", author_kind: "human" } });
    return {
      scvDir,
      sha: "fixed-sha",
      snapshot,
      graph,
      provider,
      promptRev: "p2",
      readSource: readSource(orderlyRoot),
      docs,
      reportProgress: () => {},
      force: force ?? new Set(),
    };
  }

  it("changing a doc file invalidates docs and layers but not functions", async () => {
    const provider1 = fakeProvider();
    const ctx1 = makeCtx(provider1, [{ path: "README.md", content: "# original readme content, long enough" }]);
    await ensureArtifact("functions", ctx1);
    await ensureArtifact("layers", ctx1);

    const provider2 = fakeProvider();
    const ctx2 = makeCtx(provider2, [{ path: "README.md", content: "# CHANGED readme content, long enough" }]);
    await ensureArtifact("layers", ctx2);

    const passACalls = (provider2.interpret as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => !String(call[0]).includes("extracting structural signal") && !String(call[0]).includes("grouping the files") &&
        !String(call[0]).includes("describing why"),
    ).length;
    expect(passACalls).toBe(0);

    const docsCalls = (provider2.interpret as ReturnType<typeof vi.fn>).mock.calls.filter((call) =>
      String(call[0]).includes("extracting structural signal"),
    ).length;
    expect(docsCalls).toBeGreaterThan(0);

    const layersCalls = (provider2.interpret as ReturnType<typeof vi.fn>).mock.calls.filter((call) =>
      String(call[0]).includes("grouping the files") || String(call[0]).includes("describing why"),
    ).length;
    expect(layersCalls).toBeGreaterThan(0);
  });

  it("reruns with unchanged docs make zero LLM calls for functions/docs/layers", async () => {
    const docs = [{ path: "README.md", content: "# stable readme content, long enough" }];
    const provider1 = fakeProvider();
    const ctx1 = makeCtx(provider1, docs);
    await ensureArtifact("layers", ctx1);

    const provider2 = fakeProvider();
    const ctx2 = makeCtx(provider2, docs);
    await ensureArtifact("layers", ctx2);

    expect(provider2.interpret).not.toHaveBeenCalled();
  });

  it("--force recomputes the named artifact even with unchanged inputs, without touching upstream", async () => {
    const docs = [{ path: "README.md", content: "# stable readme content, long enough" }];
    const provider1 = fakeProvider();
    const ctx1 = makeCtx(provider1, docs);
    await ensureArtifact("functions", ctx1);
    await ensureArtifact("layers", ctx1);

    const provider2 = fakeProvider();
    const ctx2 = makeCtx(provider2, docs, new Set(["layers"]));
    await ensureArtifact("layers", ctx2);

    const passACalls = (provider2.interpret as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => !String(call[0]).includes("grouping the files") && !String(call[0]).includes("describing why"),
    ).length;
    expect(passACalls).toBe(0);

    const layersCalls = (provider2.interpret as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => String(call[0]).includes("grouping the files") || String(call[0]).includes("describing why"),
    ).length;
    expect(layersCalls).toBeGreaterThan(0);
  });

  it("--force on layers cascades to groups only if the forced output actually differs", async () => {
    const docs = [{ path: "README.md", content: "# stable readme content, long enough" }];
    const provider1 = fakeProvider();
    const ctx1 = makeCtx(provider1, docs);
    await ensureArtifact("groups", ctx1);

    const provider2 = fakeProvider();
    const ctx2 = makeCtx(provider2, docs, new Set(["layers"]));
    await ensureArtifact("groups", ctx2);

    const groupsCalls = (provider2.interpret as ReturnType<typeof vi.fn>).mock.calls.filter((call) =>
      String(call[0]).includes("grouping a codebase's architectural layers"),
    ).length;
    expect(groupsCalls).toBe(0);
  });
});

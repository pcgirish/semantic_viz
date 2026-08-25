import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractRepo } from "@scv/extractor";
import type { Provider, ProviderResult } from "@scv/interpreter";
import { assembleSnapshotFromCache } from "../src/assemble-snapshot.js";
import { ensureArtifact, type ArtifactContext } from "../src/artifacts.js";
import { toSnapshot } from "../src/snapshot.js";

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
      if (prompt.includes("naming and describing")) {
        const files = [...prompt.matchAll(/^- (\S+):/gm)].length;
        return {
          text: JSON.stringify({ name: `cluster_${files}`, what: "misc what", how: "misc how", when: "misc when", where: "misc where", why: "misc layer", confidence: 0.5 }),
          tokens: 10,
        };
      }
      if (prompt.includes("proposing merges of a codebase's architectural layers")) {
        return { text: JSON.stringify({ merges: {} }), tokens: 10 };
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

describe("assembleSnapshotFromCache", () => {
  let scvDir: string;

  beforeEach(() => {
    scvDir = mkdtempSync(path.join(tmpdir(), "scv-assemble-"));
  });
  afterEach(() => {
    rmSync(scvDir, { recursive: true, force: true });
  });

  function makeCtx(provider: Provider): ArtifactContext {
    const graph = extractRepo(orderlyRoot);
    const rev = { sha: "fixed-sha", kind: "commit" as const, ts: "2020-01-01T00:00:00Z", author: "test", author_kind: "human" as const };
    const snapshot = toSnapshot(graph, { root: orderlyRoot, rev });
    return {
      scvDir,
      sha: "fixed-sha",
      snapshot,
      graph,
      provider,
      promptRev: "p2",
      readSource: () => "",
      docs: [],
      reportProgress: () => {},
      force: new Set(),
      noLlm: true,
    };
  }

  const rev = { sha: "fixed-sha", kind: "commit" as const, ts: "2020-01-01T00:00:00Z", author: "test", author_kind: "human" as const };

  it("assembles entirely from empty defaults, calling no provider, when nothing is cached", async () => {
    const provider = fakeProvider();
    const ctx = makeCtx(provider);

    const result = await assembleSnapshotFromCache({ ctx, rev, scvDir });

    expect(provider.interpret).not.toHaveBeenCalled();
    expect(result.emptyArtifacts.sort()).toEqual(["clusters", "docs", "flows", "functions", "groups", "layers"]);
    expect(result.snapshot.units.every((u) => u.semantics === null)).toBe(true);
    expect(existsSyncPath(result.path)).toBe(true);
  });

  it("reflects a partial cache — functions cached, layers not — without calling the provider", async () => {
    const providerForCache = fakeProvider();
    const ctxForCache = makeCtx(providerForCache);
    await ensureArtifact("functions", ctxForCache);

    const provider = fakeProvider();
    const ctx = makeCtx(provider);
    const result = await assembleSnapshotFromCache({ ctx, rev, scvDir });

    expect(provider.interpret).not.toHaveBeenCalled();
    expect(result.emptyArtifacts.sort()).toEqual(["clusters", "docs", "flows", "groups", "layers"]);
    expect(result.snapshot.units.some((u) => u.kind === "function")).toBe(true);
    expect(result.snapshot.units.some((u) => u.kind === "layer")).toBe(false);
  });

  it("reparents layers under a real group once groups is cached too", async () => {
    const providerForCache = fakeProvider();
    const ctxForCache = makeCtx(providerForCache);
    await ensureArtifact("functions", ctxForCache);
    await ensureArtifact("layers", ctxForCache);
    await ensureArtifact("groups", ctxForCache);

    const provider = fakeProvider();
    const ctx = makeCtx(provider);
    const result = await assembleSnapshotFromCache({ ctx, rev, scvDir });

    expect(provider.interpret).not.toHaveBeenCalled();
    expect(result.emptyArtifacts.sort()).toEqual(["flows"]);
    const groupUnits = result.snapshot.units.filter((u) => u.kind === "group");
    expect(groupUnits.length).toBeGreaterThan(0);
    const layerUnits = result.snapshot.units.filter((u) => u.kind === "layer");
    expect(layerUnits.length).toBeGreaterThan(0);
    for (const layer of layerUnits) {
      expect(layer.parent && groupUnits.some((g) => g.id === layer.parent)).toBe(true);
    }
  });
});

function existsSyncPath(p: string): boolean {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractRepo } from "@scv/extractor";
import type { Layer, Provider, ProviderResult } from "@scv/interpreter";
import { CLUSTERING_VERSION, layerIdFor } from "@scv/interpreter";
import { toSnapshot } from "../src/snapshot.js";
import { ancestorShas } from "../src/rev.js";
import { ARTIFACT_SCHEMA_VERSION, ensureArtifact, loadPreviousLayers, type ArtifactContext, type LayersData } from "../src/artifacts.js";

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

  function makeCtx(
    provider: Provider,
    docs: { path: string; content: string }[],
    force?: ArtifactContext["force"],
    promptRev = "p2",
    previousLayers?: Map<string, Layer>,
  ): ArtifactContext {
    const graph = extractRepo(orderlyRoot);
    const snapshot = toSnapshot(graph, { root: orderlyRoot, rev: { sha: "fixed-sha", kind: "commit", ts: "2020-01-01T00:00:00Z", author: "test", author_kind: "human" } });
    return {
      scvDir,
      sha: "fixed-sha",
      snapshot,
      graph,
      provider,
      promptRev,
      readSource: readSource(orderlyRoot),
      docs,
      reportProgress: () => {},
      force: force ?? new Set(),
      previousLayers,
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
      (call) => !String(call[0]).includes("extracting structural signal") && !String(call[0]).includes("naming and describing"),
    ).length;
    expect(passACalls).toBe(0);

    const docsCalls = (provider2.interpret as ReturnType<typeof vi.fn>).mock.calls.filter((call) =>
      String(call[0]).includes("extracting structural signal"),
    ).length;
    expect(docsCalls).toBeGreaterThan(0);

    const layersCalls = (provider2.interpret as ReturnType<typeof vi.fn>).mock.calls.filter((call) =>
      String(call[0]).includes("naming and describing"),
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

  it("a changed promptRev invalidates functions/docs/layers/groups/flows even with unchanged inputs", async () => {
    const docs = [{ path: "README.md", content: "# stable readme content, long enough" }];
    const provider1 = fakeProvider();
    const ctx1 = makeCtx(provider1, docs, undefined, "p2");
    await ensureArtifact("groups", ctx1);

    const provider2 = fakeProvider();
    const ctx2 = makeCtx(provider2, docs, undefined, "p3");
    await ensureArtifact("groups", ctx2);

    // A prompt template edit must force every LLM-derived artifact to recompute, since
    // inputHash previously ignored promptRev and would otherwise keep serving stale output
    // (e.g. Pass A-blocks branch labels) after only the prompt wording changed.
    expect(provider2.interpret).toHaveBeenCalled();
    const passACalls = (provider2.interpret as ReturnType<typeof vi.fn>).mock.calls.filter((call) =>
      String(call[0]).includes("labeling the control-flow blocks"),
    ).length;
    expect(passACalls).toBeGreaterThan(0);
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
      (call) => !String(call[0]).includes("naming and describing"),
    ).length;
    expect(passACalls).toBe(0);

    const layersCalls = (provider2.interpret as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => String(call[0]).includes("naming and describing"),
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
      String(call[0]).includes("proposing merges of a codebase's architectural layers"),
    ).length;
    expect(groupsCalls).toBe(0);
  });
});

describe("ensureArtifact — artifact schema version", () => {
  let scvDir: string;

  beforeEach(() => {
    scvDir = mkdtempSync(path.join(tmpdir(), "scv-artifacts-ver-"));
  });

  afterEach(() => {
    rmSync(scvDir, { recursive: true, force: true });
  });

  function makeCtx(provider: Provider): ArtifactContext {
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
      docs: [{ path: "README.md", content: "# stable readme content, long enough" }],
      reportProgress: () => {},
      force: new Set(),
    };
  }

  it("keys the groups cache on payload shape, so bumping ARTIFACT_SCHEMA_VERSION recomputes it", () => {
    // Phase 3a changed the `groups` payload — grouped layer units became real group units —
    // while none of its *inputs* changed. The version constant is the only thing that can
    // distinguish the two, so it must participate in the cache key.
    expect(ARTIFACT_SCHEMA_VERSION).toBe("3");
  });

  it("recomputes a groups artifact whose cached inputHash predates the current version", async () => {
    const provider1 = fakeProvider();
    await ensureArtifact("groups", makeCtx(provider1));

    const artifactPath = path.join(scvDir, "artifacts", "fixed-sha", "groups.json");
    const stored = JSON.parse(readFileSync(artifactPath, "utf-8")) as { inputHash: string; data: unknown };
    writeFileSync(artifactPath, JSON.stringify({ inputHash: `${stored.inputHash}-stale`, data: stored.data }));

    const provider2 = fakeProvider();
    await ensureArtifact("groups", makeCtx(provider2));

    const groupsCalls = (provider2.interpret as ReturnType<typeof vi.fn>).mock.calls.filter((call) =>
      String(call[0]).includes("proposing merges of a codebase's architectural layers"),
    ).length;
    expect(groupsCalls).toBeGreaterThan(0);
  });

  it("returns group units, not layer units", async () => {
    const result = await ensureArtifact("groups", makeCtx(fakeProvider()));
    expect(result.groupUnits.length).toBeGreaterThan(0);
    for (const unit of result.groupUnits) expect(unit.kind).toBe("group");
    // Every layer reparents onto exactly one of them.
    const groupIds = new Set(result.groupUnits.map((u) => u.id));
    expect(result.layerParent.length).toBeGreaterThan(0);
    for (const [, groupId] of result.layerParent) expect(groupIds.has(groupId)).toBe(true);
  });
});

describe("layers artifact — carry-over across analyses", () => {
  let scvDir: string;

  beforeEach(() => {
    scvDir = mkdtempSync(path.join(tmpdir(), "scv-layers-"));
  });
  afterEach(() => {
    rmSync(scvDir, { recursive: true, force: true });
  });

  function ctxWith(provider: Provider, previousLayers?: Map<string, Layer>): ArtifactContext {
    const graph = extractRepo(orderlyRoot);
    const snapshot = toSnapshot(graph, {
      root: orderlyRoot,
      rev: { sha: "fixed-sha", kind: "commit", ts: "2020-01-01T00:00:00Z", author: "test", author_kind: "human" },
    });
    return {
      scvDir,
      sha: "fixed-sha",
      snapshot,
      graph,
      provider,
      promptRev: "p2",
      readSource: readSource(orderlyRoot),
      docs: [],
      reportProgress: () => {},
      force: new Set(),
      previousLayers,
    };
  }

  it("persists the resolved layer records alongside the units, so the next run has something to carry over", async () => {
    const layers = await ensureArtifact("layers", ctxWith(fakeProvider()));
    expect(layers.layers.length).toBe(layers.layerUnits.length);
    expect(layers.clusteringVersion).toBe(CLUSTERING_VERSION);
    // Every persisted record names a layer unit actually in the snapshot, keyed by its membership.
    const unitIds = new Set(layers.layerUnits.map((u) => u.id));
    for (const layer of layers.layers) expect(unitIds.has(layerIdFor(layer.files))).toBe(true);
  });

  it("survives a JSON round-trip — a name resolved this run is the name read back next run", async () => {
    await ensureArtifact("layers", ctxWith(fakeProvider()));
    const stored = JSON.parse(
      readFileSync(path.join(scvDir, "artifacts", "fixed-sha", "layers.json"), "utf-8"),
    ) as { data: LayersData };
    expect(stored.data.layers.length).toBeGreaterThan(0);
    for (const layer of stored.data.layers) {
      const unit = stored.data.layerUnits.find((u) => u.id === layerIdFor(layer.files));
      expect(unit?.name).toBe(layer.name);
    }
  });

  it("carries a predecessor's name onto an unchanged cluster, and makes no Pass C call for it", async () => {
    const first = await ensureArtifact("layers", ctxWith(fakeProvider()));
    const previous = new Map(
      first.layers.map((layer) => [layerIdFor(layer.files), { ...layer, name: `renamed_${layer.name}` }]),
    );

    rmSync(path.join(scvDir, "artifacts", "fixed-sha"), { recursive: true, force: true });
    const provider = fakeProvider();
    const second = await ensureArtifact("layers", ctxWith(provider, previous));

    const passCCalls = (provider.interpret as ReturnType<typeof vi.fn>).mock.calls.filter((call) =>
      String(call[0]).includes("naming and describing"),
    ).length;
    expect(passCCalls).toBe(0);
    for (const layer of second.layers) expect(layer.name.startsWith("renamed_")).toBe(true);
  });

  it("ignores a cached predecessor written by a different clustering version — an old partition is not this binary's answer", () => {
    const stale = {
      inputHash: "x",
      data: {
        layerUnits: [],
        layers: [{ name: "old", files: ["a.py"], what: "", how: "", when: "", where: "", why: "", confidence: 1, source: "llm" }],
        parentOverride: [],
        layerIdByName: [],
        repoContextText: undefined,
        clusteringVersion: `${CLUSTERING_VERSION}-old`,
        promptRev: "p2",
      },
    };
    // The walk looks at HEAD's ancestors; writing under a sha that is not one of them is the
    // point of the negative control below, so use a real ancestor for the positive path.
    const ancestors = ancestorShas(orderlyRoot);
    expect(ancestors.length).toBeGreaterThan(0);
    const dir = path.join(scvDir, "artifacts", ancestors[0]!);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "layers.json"), JSON.stringify(stale));

    expect(loadPreviousLayers(scvDir, orderlyRoot, "p2").size).toBe(0);
  });

  it("reads the nearest ancestor's layers, keyed by structural id", () => {
    const ancestors = ancestorShas(orderlyRoot);
    const layer: Layer = {
      name: "billing",
      files: ["src/billing.py"],
      what: "w", how: "h", when: "wh", where: "wr", why: "y",
      confidence: 0.9,
      source: "llm",
    };
    const dir = path.join(scvDir, "artifacts", ancestors[0]!);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "layers.json"),
      JSON.stringify({
        inputHash: "x",
        data: {
          layerUnits: [], layers: [layer], parentOverride: [], layerIdByName: [],
          repoContextText: undefined, clusteringVersion: CLUSTERING_VERSION, promptRev: "p2",
        },
      }),
    );

    const loaded = loadPreviousLayers(scvDir, orderlyRoot, "p2");
    expect(loaded.get(layerIdFor(layer.files))).toEqual(layer);
  });

  it("returns an empty map, rather than throwing, when no ancestor has been analyzed", () => {
    expect(loadPreviousLayers(scvDir, orderlyRoot, "p2").size).toBe(0);
  });

  it("ignores a predecessor narrated under a different prompt revision", () => {
    // Carry-over skips the Pass C call outright, so a stale record's prose would survive a
    // prompt change that every freshly-narrated cluster picks up — the artifact hash cannot
    // catch it, because the whole point of a hit is that no call is made.
    const ancestors = ancestorShas(orderlyRoot);
    const layer: Layer = {
      name: "billing",
      files: ["src/billing.py"],
      what: "w", how: "h", when: "wh", where: "wr", why: "y",
      confidence: 0.9,
      source: "llm",
    };
    const dir = path.join(scvDir, "artifacts", ancestors[0]!);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "layers.json"),
      JSON.stringify({
        inputHash: "x",
        data: {
          layerUnits: [], layers: [layer], parentOverride: [], layerIdByName: [],
          repoContextText: undefined, clusteringVersion: CLUSTERING_VERSION, promptRev: "p2",
        },
      }),
    );

    expect(loadPreviousLayers(scvDir, orderlyRoot, "p3").size).toBe(0);
    expect(loadPreviousLayers(scvDir, orderlyRoot, "p2").size).toBe(1);
  });
});

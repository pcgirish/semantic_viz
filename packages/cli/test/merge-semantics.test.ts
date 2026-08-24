import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractRepo } from "@scv/extractor";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeInputHash, ensureArtifact, type ArtifactContext } from "../src/artifacts.js";
import { mergeSemantics } from "../src/merge-semantics.js";
import { toSnapshot } from "../src/snapshot.js";

interface StoredLayers {
  data: {
    layerUnits: { id: string; name: string; semantics: { what: string } }[];
    layers: { name: string; files: string[] }[];
  };
}

const orderlyRoot = fileURLToPath(new URL("../../../fixtures/orderly", import.meta.url));

describe("mergeSemantics", () => {
  let scvDir: string;
  let sha: string;
  let ctx: ArtifactContext;
  let functionUnitIds: string[];

  beforeEach(async () => {
    scvDir = mkdtempSync(path.join(tmpdir(), "scv-merge-semantics-"));
    const graph = await extractRepo(orderlyRoot);
    sha = "fixed-sha";
    const snapshot = toSnapshot(graph, {
      root: orderlyRoot,
      rev: { sha, kind: "commit", ts: "2020-01-01T00:00:00Z", author: "test", author_kind: "human" },
    });

    ctx = {
      scvDir,
      sha,
      snapshot,
      graph,
      provider: {
        interpret: () => {
          throw new Error("merge-semantics must never call the provider");
        },
      } as never,
      promptRev: "test-prompt-rev",
      readSource: () => "",
      docs: [],
      reportProgress: () => {},
      force: new Set(),
    };

    functionUnitIds = graph.units.filter((u) => u.kind === "function").map((u) => u.id);
  });

  afterEach(() => {
    rmSync(scvDir, { recursive: true, force: true });
  });

  function writePending(pending: unknown): string {
    const file = path.join(scvDir, "pending", sha, "semantics.json");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(pending));
    return file;
  }

  it("merges valid unit entries into the functions artifact with correct hash/provenance", async () => {
    expect(functionUnitIds.length).toBeGreaterThan(0);
    const targetId = functionUnitIds[0]!;

    const pendingFile = writePending({
      units: {
        [targetId]: {
          kind: "function",
          semantics: {
            what: "Creates a new order",
            how: "Validates input then inserts a row",
            when: "On order creation request",
            where: "Order service",
            why: "Core checkout flow",
            confidence: 0.9,
          },
          cost: { complexity: 3, io: ["database"], confidence: 0.8 },
          tags: ["payment"],
        },
      },
    });

    const result = await mergeSemantics({ pendingFile, ctx });
    expect(result.merged).toBe(1);
    expect(result.skipped).toBe(0);

    const artifactFile = path.join(scvDir, "artifacts", sha, "functions.json");
    expect(existsSync(artifactFile)).toBe(true);
    const stored = JSON.parse(readFileSync(artifactFile, "utf-8"));

    const mergedUnit = stored.data.units.find((u: { id: string }) => u.id === targetId);
    expect(mergedUnit).toBeDefined();
    expect(mergedUnit.semantics.what).toBe("Creates a new order");
    expect(mergedUnit.semantics.source).toBe("llm");
    expect(mergedUnit.cost.complexity).toBe(3);
    expect(mergedUnit.tags).toEqual(["payment"]);
    expect(mergedUnit.provenance).toEqual({ source: "llm", pass: "A" });
    expect(typeof mergedUnit.hash.semantic).toBe("string");
    expect(mergedUnit.hash.semantic.length).toBeGreaterThan(0);

    const expectedHash = await computeInputHash("functions", ctx, {});
    expect(stored.inputHash).toBe(expectedHash);

    const data = await ensureArtifact("functions", ctx);
    const reusedUnit = data.units.find((u) => u.id === targetId);
    expect(reusedUnit?.semantics?.what).toBe("Creates a new order");
  });

  it("warns and skips unit ids that don't match current extraction", async () => {
    const pendingFile = writePending({
      units: {
        "u:does.not.exist": {
          kind: "function",
          semantics: { what: "a", how: "b", when: "c", where: "d", why: "e", confidence: 0.5 },
        },
      },
    });

    const result = await mergeSemantics({ pendingFile, ctx });
    expect(result.merged).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.warnings.length).toBe(1);
  });

  it("skips entries whose kind doesn't match the real unit's kind", async () => {
    const classUnitIds = (await extractRepo(orderlyRoot)).units.filter((u) => u.kind === "class").map((u) => u.id);
    expect(classUnitIds.length).toBeGreaterThan(0);
    const targetId = classUnitIds[0]!;

    const pendingFile = writePending({
      units: {
        [targetId]: {
          kind: "function",
          semantics: { what: "a", how: "b", when: "c", where: "d", why: "e", confidence: 0.5 },
        },
      },
    });

    const result = await mergeSemantics({ pendingFile, ctx });
    expect(result.merged).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("filters merges to unit ids matching --scope globs", async () => {
    expect(functionUnitIds.length).toBeGreaterThanOrEqual(2);
    const [firstId, secondId] = functionUnitIds;

    const pendingFile = writePending({
      units: {
        [firstId!]: {
          kind: "function",
          semantics: { what: "a", how: "b", when: "c", where: "d", why: "e", confidence: 0.5 },
        },
        [secondId!]: {
          kind: "function",
          semantics: { what: "a", how: "b", when: "c", where: "d", why: "e", confidence: 0.5 },
        },
      },
    });

    const result = await mergeSemantics({ pendingFile, ctx, scope: [firstId!] });
    expect(result.merged).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("carries full Unit shape (tags/cost/provenance) onto unmerged units, not just merged ones", async () => {
    const targetId = functionUnitIds[0]!;
    const untouchedId = functionUnitIds[1]!;
    expect(untouchedId).toBeDefined();

    const pendingFile = writePending({
      units: {
        [targetId]: {
          kind: "function",
          semantics: { what: "a", how: "b", when: "c", where: "d", why: "e", confidence: 0.5 },
        },
      },
    });

    await mergeSemantics({ pendingFile, ctx });

    const artifactFile = path.join(scvDir, "artifacts", sha, "functions.json");
    const stored = JSON.parse(readFileSync(artifactFile, "utf-8"));
    const untouchedUnit = stored.data.units.find((u: { id: string }) => u.id === untouchedId);
    expect(untouchedUnit).toBeDefined();
    expect(untouchedUnit.tags).toEqual([]);
    expect(untouchedUnit.provenance).toEqual({ source: "static" });
    expect(untouchedUnit.semantics).toBeNull();
  });

  it("with --with-clustering, preserves every real cluster's layerUnits, not only narrated ones", async () => {
    const pendingFile = writePending({ units: {}, layers: {} });

    const result = await mergeSemantics({ pendingFile, ctx, withClustering: true });
    expect(result.merged).toBe(0);

    const artifactFile = path.join(scvDir, "artifacts", sha, "layers.json");
    expect(existsSync(artifactFile)).toBe(true);
    const stored = JSON.parse(readFileSync(artifactFile, "utf-8")) as StoredLayers;

    expect(stored.data.layerUnits.length).toBeGreaterThan(0);
    expect(stored.data.layers.length).toBe(stored.data.layerUnits.length);
    for (const unit of stored.data.layerUnits) {
      expect(unit.semantics.what).toBe("(no summary)");
    }
  });

  it("with --with-clustering, narrated clusters get pending narration; others get placeholders", async () => {
    const emptyPendingFile = writePending({ units: {}, layers: {} });
    await mergeSemantics({ pendingFile: emptyPendingFile, ctx, withClustering: true });
    const baselineFile = path.join(scvDir, "artifacts", sha, "layers.json");
    const baseline = JSON.parse(readFileSync(baselineFile, "utf-8")) as StoredLayers;
    expect(baseline.data.layers.length).toBeGreaterThan(1);
    const targetLayer = baseline.data.layers[0]!;

    const pendingFile = writePending({
      units: {},
      layers: {
        chosen: {
          name: "Narrated",
          files: targetLayer.files,
          what: "Schema migrations",
          how: "Runs SQL DDL",
          when: "At migration time",
          where: "migrations/",
          why: "Keeps schema versioned",
          confidence: 0.9,
        },
      },
    });

    const result = await mergeSemantics({ pendingFile, ctx, withClustering: true });
    expect(result.merged).toBe(1);
    expect(result.skipped).toBe(0);

    const artifactFile = path.join(scvDir, "artifacts", sha, "layers.json");
    const stored = JSON.parse(readFileSync(artifactFile, "utf-8")) as StoredLayers;

    expect(stored.data.layers.length).toBe(baseline.data.layers.length);
    const narrated = stored.data.layers.find((l) => l.name === "Narrated");
    expect(narrated).toBeDefined();
    const placeholders = stored.data.layers.filter((l) => l.name !== "Narrated");
    expect(placeholders.length).toBe(baseline.data.layers.length - 1);
    for (const layer of placeholders) {
      expect(stored.data.layerUnits.find((u) => u.name === layer.name)?.semantics.what).toBe("(no summary)");
    }
  });
});

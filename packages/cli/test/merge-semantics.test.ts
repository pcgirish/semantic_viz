import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractRepo } from "@scv/extractor";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeInputHash, ensureArtifact, type ArtifactContext } from "../src/artifacts.js";
import { mergeSemantics } from "../src/merge-semantics.js";
import { toSnapshot } from "../src/snapshot.js";

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
});

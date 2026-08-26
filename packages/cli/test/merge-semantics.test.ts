import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractRepo } from "@scv/extractor";
import { buildFlowTracingContext, traceFlowSteps } from "@scv/interpreter";
import { semanticHashInput, type Unit } from "@scv/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeInputHash, ensureArtifact, type ArtifactContext } from "../src/artifacts.js";
import { mergeFlows, mergeSemantics, runMergeSemantics } from "../src/merge-semantics.js";
import { headRev } from "../src/rev.js";
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

    const result = await mergeSemantics({ pendingFile, ctx, root: orderlyRoot });
    expect(result.merged).toBe(1);
    expect(result.skipped).toBe(0);

    const artifactFile = path.join(scvDir, "artifacts", sha, "functions.json");
    expect(existsSync(artifactFile)).toBe(true);
    const stored = JSON.parse(readFileSync(artifactFile, "utf-8"));

    const mergedUnit = stored.data.units.find((u: { id: string }) => u.id === targetId);
    expect(mergedUnit).toBeDefined();
    expect(mergedUnit.semantics.what).toBe("Creates a new order");
    expect(mergedUnit.semantics.source).toBe("manual");
    expect(mergedUnit.cost.complexity).toBe(3);
    expect(mergedUnit.cost.source).toBe("manual");
    expect(mergedUnit.tags).toEqual(["payment"]);
    expect(mergedUnit.provenance).toEqual({ source: "manual", pass: "A" });
    expect(typeof mergedUnit.hash.semantic).toBe("string");
    expect(mergedUnit.hash.semantic.length).toBeGreaterThan(0);

    const expectedHash = await computeInputHash("functions", ctx, {});
    expect(stored.inputHash).toBe(expectedHash);

    const data = (await ensureArtifact("functions", ctx)).data;
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

    const result = await mergeSemantics({ pendingFile, ctx, root: orderlyRoot });
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

    const result = await mergeSemantics({ pendingFile, ctx, root: orderlyRoot });
    expect(result.merged).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("filters merges to unit ids matching an exact --scope entry", async () => {
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

    const result = await mergeSemantics({ pendingFile, ctx, root: orderlyRoot, scope: [firstId!] });
    expect(result.merged).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("filters merges to unit ids matching a --scope glob", async () => {
    expect(functionUnitIds.length).toBeGreaterThanOrEqual(2);
    const [firstId, secondId] = functionUnitIds;
    const commonPrefix = firstId!.slice(0, firstId!.lastIndexOf(".") + 1);
    expect(secondId!.startsWith(commonPrefix)).toBe(true);

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

    const result = await mergeSemantics({ pendingFile, ctx, root: orderlyRoot, scope: [`${commonPrefix}*`] });
    expect(result.merged).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it("--scope all (or omitted) merges every entry", async () => {
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

    const result = await mergeSemantics({ pendingFile, ctx, root: orderlyRoot, scope: ["all"] });
    expect(result.merged).toBe(2);
  });

  it("--scope changed restricts merges to units whose file changed vs HEAD~1", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "scv-merge-semantics-changed-"));
    try {
      const run = (cmd: string) => execSync(cmd, { cwd: repoRoot, stdio: "pipe" });
      run("git init -q");
      run('git config user.email "test@example.com"');
      run('git config user.name "Test"');
      mkdirSync(path.join(repoRoot, "src"), { recursive: true });
      writeFileSync(path.join(repoRoot, "src", "a.py"), "def a():\n    pass\n");
      writeFileSync(path.join(repoRoot, "src", "b.py"), "def b():\n    pass\n");
      run("git add -A && git commit -q -m base");
      writeFileSync(path.join(repoRoot, "src", "a.py"), "def a():\n    return 1\n");
      run("git add -A && git commit -q -m change-a");

      const graph = await extractRepo(repoRoot);
      const changedSha = "changed-sha";
      const snapshot = toSnapshot(graph, {
        root: repoRoot,
        rev: { sha: changedSha, kind: "commit", ts: "2020-01-01T00:00:00Z", author: "test", author_kind: "human" },
      });
      const changedScvDir = mkdtempSync(path.join(tmpdir(), "scv-merge-semantics-changed-scv-"));
      const changedCtx: ArtifactContext = { ...ctx, scvDir: changedScvDir, sha: changedSha, snapshot, graph };

      const unitA = graph.units.find((u) => u.kind === "function" && u.loc.file === "src/a.py")!;
      const unitB = graph.units.find((u) => u.kind === "function" && u.loc.file === "src/b.py")!;
      expect(unitA).toBeDefined();
      expect(unitB).toBeDefined();

      const pendingFile = path.join(changedScvDir, "pending", changedSha, "semantics.json");
      mkdirSync(path.dirname(pendingFile), { recursive: true });
      writeFileSync(
        pendingFile,
        JSON.stringify({
          units: {
            [unitA.id]: { kind: "function", semantics: { what: "a", how: "b", when: "c", where: "d", why: "e", confidence: 0.5 } },
            [unitB.id]: { kind: "function", semantics: { what: "a", how: "b", when: "c", where: "d", why: "e", confidence: 0.5 } },
          },
        }),
      );

      const result = await mergeSemantics({ pendingFile, ctx: changedCtx, root: repoRoot, scope: ["changed"] });
      expect(result.merged).toBe(1);
      expect(result.skipped).toBe(0);

      const artifactFile = path.join(changedScvDir, "artifacts", changedSha, "functions.json");
      const stored = JSON.parse(readFileSync(artifactFile, "utf-8"));
      expect(stored.data.units.find((u: { id: string }) => u.id === unitA.id)?.semantics?.what).toBe("a");
      expect(stored.data.units.find((u: { id: string }) => u.id === unitB.id)?.semantics).toBeNull();
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
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

    await mergeSemantics({ pendingFile, ctx, root: orderlyRoot });

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

    const result = await mergeSemantics({ pendingFile, ctx, root: orderlyRoot, withClustering: true });
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
    await mergeSemantics({ pendingFile: emptyPendingFile, ctx, root: orderlyRoot, withClustering: true });
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

    const result = await mergeSemantics({ pendingFile, ctx, root: orderlyRoot, withClustering: true });
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

  it("with --with-clustering, clusters inputHash reflects a cached docs artifact instead of assuming empty docs", async () => {
    const pendingFile = writePending({ units: {}, layers: {} });

    await mergeSemantics({ pendingFile, ctx, root: orderlyRoot, withClustering: true });
    const artifactFile = path.join(scvDir, "artifacts", sha, "clusters.json");
    const hashWithoutDocs = (JSON.parse(readFileSync(artifactFile, "utf-8")) as { inputHash: string }).inputHash;

    const docs = [{ path: "README.md", title: "Readme", summary: "Overview", what: "", how: "", when: "", where: "", why: "", confidence: 0.8 }];
    const docsFile = path.join(scvDir, "artifacts", sha, "docs.json");
    writeFileSync(docsFile, JSON.stringify({ inputHash: "irrelevant-for-this-test", data: docs }));

    await mergeSemantics({ pendingFile, ctx, root: orderlyRoot, withClustering: true });
    const hashWithDocs = (JSON.parse(readFileSync(artifactFile, "utf-8")) as { inputHash: string }).inputHash;

    expect(hashWithDocs).not.toBe(hashWithoutDocs);
  });

  it("with --with-clustering, merges pending layer narration even when doc files exist but no docs artifact is cached yet (standard analyze --no-llm workflow)", async () => {
    const docsScvDir = mkdtempSync(path.join(tmpdir(), "scv-merge-semantics-docs-"));
    try {
      const docsCtx: ArtifactContext = { ...ctx, scvDir: docsScvDir, docs: [{ path: "README.md", content: "# Orderly\n\nSome real content here." }] };

      const emptyPendingFile = writePending({ units: {}, layers: {} });
      const baselineResult = await mergeSemantics({ pendingFile: emptyPendingFile, ctx: docsCtx, root: orderlyRoot, withClustering: true });
      expect(baselineResult.warnings.some((w) => w.includes("cached an empty docs artifact"))).toBe(true);
      const layersArtifactFile = path.join(docsScvDir, "artifacts", sha, "layers.json");
      const baseline = JSON.parse(readFileSync(layersArtifactFile, "utf-8")) as StoredLayers;
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
      const result = await mergeSemantics({ pendingFile, ctx: docsCtx, root: orderlyRoot, withClustering: true });

      expect(result.merged).toBe(1);

      const stored = JSON.parse(readFileSync(layersArtifactFile, "utf-8")) as StoredLayers;
      expect(stored.data.layers.find((l) => l.name === "Narrated")).toBeDefined();

      const docsArtifactFile = path.join(docsScvDir, "artifacts", sha, "docs.json");
      expect(existsSync(docsArtifactFile)).toBe(true);
      const storedDocs = JSON.parse(readFileSync(docsArtifactFile, "utf-8")) as { inputHash: string; data: unknown[] };
      expect(storedDocs.data).toEqual([]);

      const realDocsHash = await computeInputHash("docs", docsCtx, {});
      expect(storedDocs.inputHash).toBe(realDocsHash);
      const docsViaEnsure = await ensureArtifact("docs", docsCtx);
      expect(docsViaEnsure.data).toEqual([]);
    } finally {
      rmSync(docsScvDir, { recursive: true, force: true });
    }
  });

  /** Groups merge against real layers, so every group test first builds a fresh `layers` artifact
   *  the deterministic way: a `--with-clustering` merge with no pending narration. */
  async function seedLayers(): Promise<{ name: string; files: string[] }[]> {
    const emptyPendingFile = writePending({ units: {}, layers: {} });
    await mergeSemantics({ pendingFile: emptyPendingFile, ctx, root: orderlyRoot, withClustering: true });
    const stored = JSON.parse(readFileSync(path.join(scvDir, "artifacts", sha, "layers.json"), "utf-8")) as StoredLayers;
    return stored.data.layers;
  }

  const narration = { what: "w", how: "h", when: "n", where: "e", why: "y", confidence: 0.7 };

  function readGroups(): { groupUnits: Unit[]; layerParent: [string, string][] } {
    return (JSON.parse(readFileSync(path.join(scvDir, "artifacts", sha, "groups.json"), "utf-8")) as { data: { groupUnits: Unit[]; layerParent: [string, string][] } }).data;
  }

  it("with --with-groups, merges a pending group with resolved children, manual provenance and a recomputed semantic hash", async () => {
    const layers = await seedLayers();
    expect(layers.length).toBeGreaterThan(1);
    const target = layers[0]!;

    const pendingFile = writePending({
      units: {},
      groups: { g1: { name: "Core", layers: [target.name], ...narration } },
    });

    const result = await mergeSemantics({ pendingFile, ctx, root: orderlyRoot, withGroups: true });
    expect(result.merged).toBe(1);
    expect(result.skipped).toBe(0);

    const data = readGroups();
    const core = data.groupUnits.find((g) => g.name === "Core");
    expect(core).toBeDefined();
    expect(core!.semantics).toEqual({ ...narration, source: "manual" });
    expect(core!.provenance).toEqual({ source: "manual", pass: "C" });
    expect(core!.children.length).toBe(1);

    // Recomputed against the merged narration, not the `semantics: null` the unit was built with.
    const stale = createHash("sha1").update(semanticHashInput("Core", null)).digest("hex");
    expect(core!.hash.semantic).not.toBe(stale);
    expect(core!.hash.semantic).toBe(createHash("sha1").update(semanticHashInput("Core", core!.semantics)).digest("hex"));

    // Unclaimed layers land in the automatic bucket, still unnarrated.
    const ungrouped = data.groupUnits.find((g) => g.name === "Ungrouped");
    expect(ungrouped).toBeDefined();
    expect(ungrouped!.semantics).toBeNull();
    expect(data.layerParent.length).toBe(layers.length);
  });

  it("with --with-groups, matches by resolved member-id set so a renamed group still merges", async () => {
    const layers = await seedLayers();
    const target = layers[0]!;

    const pendingFile = writePending({
      units: {},
      groups: { g1: { name: "Totally Different Name", layers: [target.name], ...narration } },
    });

    const result = await mergeSemantics({ pendingFile, ctx, root: orderlyRoot, withGroups: true });
    expect(result.merged).toBe(1);
    expect(readGroups().groupUnits.find((g) => g.name === "Totally Different Name")?.semantics?.what).toBe("w");
  });

  it("with --with-groups, an entry naming an unknown layer is skipped without discarding valid entries", async () => {
    const layers = await seedLayers();

    const pendingFile = writePending({
      units: {},
      groups: {
        bad: { name: "Bad", layers: ["no-such-layer"], ...narration },
        good: { name: "Good", layers: [layers[0]!.name], ...narration },
      },
    });

    const result = await mergeSemantics({ pendingFile, ctx, root: orderlyRoot, withGroups: true });
    expect(result.merged).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.warnings.some((w) => w.includes('group "bad" references unknown/ambiguous layer "no-such-layer"'))).toBe(true);

    const names = readGroups().groupUnits.map((g) => g.name);
    expect(names).toContain("Good");
    expect(names).not.toContain("Bad");
  });

  it("with --with-groups, a second group claiming an already-claimed layer is skipped, the first still merges", async () => {
    const layers = await seedLayers();
    const shared = layers[0]!.name;

    const pendingFile = writePending({
      units: {},
      groups: {
        first: { name: "First", layers: [shared], ...narration },
        second: { name: "Second", layers: [shared], ...narration },
      },
    });

    const result = await mergeSemantics({ pendingFile, ctx, root: orderlyRoot, withGroups: true });
    expect(result.merged).toBe(1);
    expect(result.warnings.some((w) => w.includes('group "second" claims layer'))).toBe(true);

    const names = readGroups().groupUnits.map((g) => g.name);
    expect(names).toContain("First");
    expect(names).not.toContain("Second");
  });

  it("with --with-groups, two entries sharing one name are both skipped rather than silently overwriting", async () => {
    const layers = await seedLayers();
    expect(layers.length).toBeGreaterThan(2);

    const pendingFile = writePending({
      units: {},
      groups: {
        a: { name: "X", layers: [layers[0]!.name], ...narration },
        b: { name: "X", layers: [layers[1]!.name], ...narration },
        c: { name: "Fine", layers: [layers[2]!.name], ...narration },
      },
    });

    const result = await mergeSemantics({ pendingFile, ctx, root: orderlyRoot, withGroups: true });
    expect(result.merged).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.warnings.some((w) => w.includes('group name "X" is used by more than one pending entry'))).toBe(true);

    const names = readGroups().groupUnits.map((g) => g.name);
    expect(names).not.toContain("X");
    expect(names).toContain("Fine");
  });

  it("with --with-groups, an entry listing the same layer twice is skipped without aborting the whole merge", async () => {
    const layers = await seedLayers();

    const pendingFile = writePending({
      units: {},
      groups: {
        dup: { name: "Dup", layers: [layers[0]!.name, layers[0]!.name], ...narration },
        ok: { name: "Ok", layers: [layers[1]!.name], ...narration },
      },
    });

    const result = await mergeSemantics({ pendingFile, ctx, root: orderlyRoot, withGroups: true });
    expect(result.merged).toBe(1);
    expect(result.warnings.some((w) => w.includes('group "dup" lists layer'))).toBe(true);
    expect(readGroups().groupUnits.map((g) => g.name)).toContain("Ok");
  });

  it("with --with-groups, errors instead of grouping against a missing layers artifact", async () => {
    const pendingFile = writePending({ units: {}, groups: {} });
    await expect(mergeSemantics({ pendingFile, ctx, root: orderlyRoot, withGroups: true })).rejects.toThrow(/layers artifact is missing or stale/);
  });

  it("with --with-groups, groups inputHash is stable across identical re-runs", async () => {
    await seedLayers();
    const layers = await seedLayers();
    const pendingFile = writePending({ units: {}, groups: { g1: { name: "Core", layers: [layers[0]!.name], ...narration } } });

    const groupsFile = path.join(scvDir, "artifacts", sha, "groups.json");
    await mergeSemantics({ pendingFile, ctx, root: orderlyRoot, withGroups: true });
    const first = (JSON.parse(readFileSync(groupsFile, "utf-8")) as { inputHash: string }).inputHash;
    await mergeSemantics({ pendingFile, ctx, root: orderlyRoot, withGroups: true });
    expect((JSON.parse(readFileSync(groupsFile, "utf-8")) as { inputHash: string }).inputHash).toBe(first);
  });

  const flowEntryUnit = "u:src.orders.create_order.create_order";

  function readFlows(): Unit[] {
    return (JSON.parse(readFileSync(path.join(scvDir, "artifacts", sha, "flows.json"), "utf-8")) as { data: Unit[] }).data;
  }

  it("with --with-flows, merges a pending flow whose trace matches what runFlowsPass would produce", async () => {
    const pendingFile = writePending({
      units: {},
      flows: { f1: { name: "Create order", route: "POST /orders", entryUnit: flowEntryUnit, tags: ["api"], ...narration } },
    });

    const result = await mergeSemantics({ pendingFile, ctx, root: orderlyRoot, withFlows: true });
    expect(result.merged).toBe(1);
    expect(result.skipped).toBe(0);

    const flows = readFlows();
    expect(flows.length).toBe(1);
    const flow = flows[0]!;
    expect(flow.kind).toBe("api_flow");
    expect(flow.semantics).toEqual({ ...narration, source: "manual" });
    expect(flow.provenance).toEqual({ source: "manual", pass: "C" });
    expect(flow.hash.semantic).toBeNull();
    expect(flow.tags).toEqual(["api"]);

    // Parity with the real pipeline: same helpers, so same DI prefix and same branching shape.
    const tracing = buildFlowTracingContext({ snapshot: ctx.snapshot, graph: ctx.graph, units: ctx.snapshot.units });
    const expected = traceFlowSteps(flowEntryUnit, new Set(ctx.snapshot.units.map((u) => u.id)), tracing)!;
    expect(expected).not.toBeNull();
    expect(flow.steps).toEqual(expected.steps);
    expect(flow.stepsBranching).toEqual(expected.stepsBranching);
    // The DI dependencies really are spliced in ahead of the handler, not merely traced from it.
    expect(expected.steps.indexOf("u:src.auth.verify_token")).toBeLessThan(expected.steps.indexOf(flowEntryUnit));
  });

  it("with --with-flows, warns and skips an entryUnit that is not an eligible entry point", async () => {
    const pendingFile = writePending({
      units: {},
      flows: { f1: { name: "Nope", route: "GET /nope", entryUnit: "u:does.not.exist", tags: [], ...narration } },
    });

    const result = await mergeSemantics({ pendingFile, ctx, root: orderlyRoot, withFlows: true });
    expect(result.merged).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.warnings.some((w) => w.includes("is not an eligible entry point"))).toBe(true);
    expect(readFlows()).toEqual([]);
  });

  it("with --with-flows, accepts exactly the entry points the real flows pass proposes from", async () => {
    // The zero-LLM merge path exists to produce what Pass C would produce, minus the narration
    // call. `runFlowsPass` proposes entry points from `buildFlowTracingContext`'s
    // `flowUnitSummaries` (non-test `function` *and* `class` units), so `mergeFlows` must accept
    // that same set. Narrowing eligibility to `function` here would make a class-rooted flow
    // reachable via `analyze` but not via `merge-semantics` — class-based route handlers
    // (Django CBVs, Flask MethodView, DRF APIView) are ordinary entry points.
    const tracing = buildFlowTracingContext({ snapshot: ctx.snapshot, graph: ctx.graph, units: ctx.snapshot.units });
    const eligible = new Set(tracing.flowUnitSummaries.map((u) => u.id));
    const unitById = new Map(ctx.snapshot.units.map((u) => [u.id, u]));

    expect([...eligible].every((id) => ["function", "class"].includes(unitById.get(id)!.kind))).toBe(true);
    expect(eligible.has(flowEntryUnit)).toBe(true);

    // A module is a real unit but never an entry point, so eligibility is genuinely a filter.
    const moduleUnit = ctx.snapshot.units.find((u) => u.kind === "module")!;
    expect(eligible.has(moduleUnit.id)).toBe(false);

    const pendingFile = writePending({
      units: {},
      flows: { f1: { name: "Nope", route: "GET /nope", entryUnit: moduleUnit.id, tags: [], ...narration } },
    });
    const result = await mergeSemantics({ pendingFile, ctx, root: orderlyRoot, withFlows: true });
    expect(result.merged).toBe(0);
    expect(result.warnings.some((w) => w.includes("is not an eligible entry point"))).toBe(true);
  });

  it("with --with-flows, keeps the first of two entries colliding on the same flow id", async () => {
    const pendingFile = writePending({
      units: {},
      flows: {
        a: { name: "First", route: "POST /orders", entryUnit: flowEntryUnit, tags: [], ...narration },
        b: { name: "Second", route: "POST /orders", entryUnit: flowEntryUnit, tags: [], ...narration },
      },
    });

    const result = await mergeSemantics({ pendingFile, ctx, root: orderlyRoot, withFlows: true });
    expect(result.merged).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.warnings.some((w) => w.includes("same route and traced steps"))).toBe(true);
    expect(readFlows().map((f) => f.name)).toEqual(["First"]);
  });

  it("with --with-flows, falls back to snapshot units when no functions artifact was ever persisted", async () => {
    // `mergeSemantics` always writes `functions` before flows, so exercise mergeFlows' own
    // snapshot fallback directly, against a scvDir where nothing has been persisted yet.
    expect(existsSync(path.join(scvDir, "artifacts", sha, "functions.json"))).toBe(false);

    const result = await mergeFlows(
      ctx,
      { f1: { name: "Create order", route: "POST /orders", entryUnit: flowEntryUnit, tags: [], ...narration } },
      false,
      [],
    );
    expect(result.merged).toBe(1);
    expect(readFlows().length).toBe(1);
  });

  it("with --with-flows, errors rather than tracing against a stale persisted functions artifact", async () => {
    const pendingFile = writePending({
      units: {},
      flows: { f1: { name: "Create order", route: "POST /orders", entryUnit: flowEntryUnit, tags: [], ...narration } },
    });
    await mergeSemantics({ pendingFile, ctx, root: orderlyRoot, withFlows: true });

    // `functions` hashes over the extraction graph, so a ctx whose graph has drifted since that
    // artifact was written is exactly the "persisted but stale" case. Driven through `mergeFlows`
    // directly because `mergeSemantics` always rewrites `functions` fresh before reaching flows.
    const drifted: ArtifactContext = { ...ctx, graph: { ...ctx.graph, units: ctx.graph.units.slice(1) } };

    await expect(mergeFlows(drifted, {}, false, [])).rejects.toThrow(/functions artifact is stale/);
  });

  it("with --with-flows, refuses a graph rebuilt from a persisted snapshot", async () => {
    const historicalSha = "historical-flows-sha";
    const historicalSnapshot = toSnapshot(await extractRepo(orderlyRoot), {
      root: orderlyRoot,
      rev: { sha: historicalSha, kind: "commit", ts: "2019-01-01T00:00:00Z", author: "test", author_kind: "human" },
    });
    const snapshotFile = path.join(scvDir, "snapshots", `${historicalSha}.json`);
    mkdirSync(path.dirname(snapshotFile), { recursive: true });
    writeFileSync(snapshotFile, JSON.stringify(historicalSnapshot));

    const pendingFile = path.join(scvDir, "pending", historicalSha, "semantics.json");
    mkdirSync(path.dirname(pendingFile), { recursive: true });
    writeFileSync(pendingFile, JSON.stringify({ units: {}, flows: {} }));

    await expect(runMergeSemantics({ root: orderlyRoot, pendingFile, scvDir, sha: historicalSha, withFlows: true })).rejects.toThrow(
      /flow merging requires live extraction/,
    );
  });

  it("with --with-flows, flows inputHash is stable across identical re-runs", async () => {
    const pendingFile = writePending({
      units: {},
      flows: { f1: { name: "Create order", route: "POST /orders", entryUnit: flowEntryUnit, tags: [], ...narration } },
    });
    const flowsFile = path.join(scvDir, "artifacts", sha, "flows.json");

    await mergeSemantics({ pendingFile, ctx, root: orderlyRoot, withFlows: true });
    const first = (JSON.parse(readFileSync(flowsFile, "utf-8")) as { inputHash: string }).inputHash;
    await mergeSemantics({ pendingFile, ctx, root: orderlyRoot, withFlows: true });
    expect((JSON.parse(readFileSync(flowsFile, "utf-8")) as { inputHash: string }).inputHash).toBe(first);
  });

  it("--sha with a persisted .scv/snapshots/<sha>.json merges against that snapshot, not the current worktree", async () => {
    const historicalSha = "historical-sha";
    const historicalSnapshot = toSnapshot(await extractRepo(orderlyRoot), {
      root: orderlyRoot,
      rev: { sha: historicalSha, kind: "commit", ts: "2019-01-01T00:00:00Z", author: "test", author_kind: "human" },
    });
    const snapshotFile = path.join(scvDir, "snapshots", `${historicalSha}.json`);
    mkdirSync(path.dirname(snapshotFile), { recursive: true });
    writeFileSync(snapshotFile, JSON.stringify(historicalSnapshot));

    const targetId = historicalSnapshot.units.find((u) => u.kind === "function")!.id;
    const pendingFile = path.join(scvDir, "pending", historicalSha, "semantics.json");
    mkdirSync(path.dirname(pendingFile), { recursive: true });
    writeFileSync(
      pendingFile,
      JSON.stringify({
        units: {
          [targetId]: {
            kind: "function",
            semantics: { what: "a", how: "b", when: "c", where: "d", why: "e", confidence: 0.5 },
          },
        },
      }),
    );

    const result = await runMergeSemantics({ root: orderlyRoot, pendingFile, scvDir, sha: historicalSha });
    expect(result.merged).toBe(1);
    expect(result.skipped).toBe(0);

    const artifactFile = path.join(scvDir, "artifacts", historicalSha, "functions.json");
    expect(existsSync(artifactFile)).toBe(true);
    const stored = JSON.parse(readFileSync(artifactFile, "utf-8"));
    expect(stored.data.units.find((u: { id: string }) => u.id === targetId)?.semantics?.what).toBe("a");

    expect(result.path).toBe(path.join(scvDir, "snapshots", `${historicalSha}.json`));
    expect(existsSync(result.path)).toBe(true);
    expect(result.emptyArtifacts.sort()).toEqual(["clusters", "docs", "flows", "groups", "layers"]);
  });

  it("without --sha, extracts the worktree live even when a snapshot for HEAD already exists", async () => {
    // A previous merge (or `analyze --no-llm`) leaves `.scv/snapshots/<head>.json` behind.
    // Reloading it would rebuild the graph via `graphFromSnapshot`, whose `extraction` input hash
    // differs from the live one — invalidating every artifact below it and making a follow-up
    // `--with-groups` merge fail as "stale". HEAD must always come from live extraction.
    const headSha = headRev(orderlyRoot).sha;
    const snapshotFile = path.join(scvDir, "snapshots", `${headSha}.json`);
    mkdirSync(path.dirname(snapshotFile), { recursive: true });
    writeFileSync(
      snapshotFile,
      JSON.stringify(toSnapshot(await extractRepo(orderlyRoot), {
        root: orderlyRoot,
        rev: { sha: headSha, kind: "commit", ts: "2019-01-01T00:00:00Z", author: "test", author_kind: "human" },
      })),
    );

    const emptyPending = path.join(scvDir, "pending", headSha, "empty.json");
    mkdirSync(path.dirname(emptyPending), { recursive: true });
    writeFileSync(emptyPending, JSON.stringify({ units: {}, layers: {} }));
    await runMergeSemantics({ root: orderlyRoot, pendingFile: emptyPending, scvDir, withClustering: true });

    const layerNames = (
      JSON.parse(readFileSync(path.join(scvDir, "artifacts", headSha, "layers.json"), "utf-8")) as StoredLayers
    ).data.layers.map((l) => l.name);

    const groupsPending = path.join(scvDir, "pending", headSha, "groups.json");
    writeFileSync(
      groupsPending,
      JSON.stringify({
        units: {},
        layers: {},
        groups: { core: { name: "Core", layers: layerNames.slice(0, 2), ...narration } },
      }),
    );

    const result = await runMergeSemantics({ root: orderlyRoot, pendingFile: groupsPending, scvDir, withGroups: true });
    expect(result.merged).toBe(1);
  });

});

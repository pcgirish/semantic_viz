import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractRepo, type SymbolGraph } from "@semviz/extractor";
import { layerIdFor } from "@semviz/interpreter";
import type { PendingSemantics } from "@semviz/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArtifactContext } from "../src/artifacts.js";
import { readAuthoredRecord } from "../src/authored-record.js";
import { computeClusters, emptyAuthoredSet, evaluate } from "../src/fingerprints.js";
import { mergeSemantics } from "../src/merge-semantics.js";
import { toSnapshot } from "../src/snapshot.js";
import { gitFixture, mergeInto } from "./git-fixture.js";

const orderlyRoot = fileURLToPath(new URL("../../../fixtures/orderly", import.meta.url));
const narration = { what: "w", how: "h", when: "n", where: "r", why: "y", confidence: 1 };

function pendingOf(partial: Partial<PendingSemantics>): PendingSemantics {
  return { units: {}, layers: {}, groups: {}, flows: {}, docs: {}, ...partial };
}

describe("mergeSemantics authored record", () => {
  let scvDir: string;
  let graph: SymbolGraph;
  let ctx: ArtifactContext;

  beforeEach(async () => {
    scvDir = mkdtempSync(path.join(tmpdir(), "scv-merge-record-"));
    graph = await extractRepo(orderlyRoot);
    const snapshot = toSnapshot(graph, { root: orderlyRoot, rev: { sha: "sha", kind: "commit", ts: "", author: "", author_kind: "human" } });
    ctx = {
      scvDir,
      sha: "sha",
      snapshot,
      graph,
      provider: { interpret: () => { throw new Error("no provider"); } } as never,
      promptRev: "p",
      readSource: () => "",
      docs: [],
      reportProgress: () => {},
      force: new Set(),
    };
  });
  afterEach(() => rmSync(scvDir, { recursive: true, force: true }));

  const inputs = () => ({ graph: ctx.graph, snapshot: ctx.snapshot, docs: ctx.docs });

  it("stamps merged units with their merge-time fingerprint and keeps earlier entries across merges", async () => {
    const [first, second] = graph.units.filter((u) => u.kind === "function").map((u) => u.id);
    await mergeSemantics({ ctx, root: orderlyRoot, pending: pendingOf({ units: { [first!]: { kind: "function", semantics: narration } } }) });
    await mergeSemantics({ ctx, root: orderlyRoot, pending: pendingOf({ units: { [second!]: { kind: "function", semantics: narration } } }) });

    const record = readAuthoredRecord(scvDir, "sha");
    const fingerprints = evaluate(inputs(), record, emptyAuthoredSet()).functions;
    expect(Object.keys(record.functions).sort()).toEqual([first, second].sort());
    for (const id of [first!, second!]) {
      expect(record.functions[id]!.entry.semantics?.what).toBe("w");
      expect(record.functions[id]!.fingerprint).toBe(fingerprints.get(id)!.fingerprint);
    }
  });

  it("does not record units that were skipped", async () => {
    await mergeSemantics({ ctx, root: orderlyRoot, pending: pendingOf({ units: { "u:missing": { kind: "function", semantics: narration } } }) });
    expect(readAuthoredRecord(scvDir, "sha").functions).toEqual({});
  });

  it("records narrated layers keyed by cluster id, stamped with the layers fingerprint", async () => {
    await mergeSemantics({ ctx, root: orderlyRoot, pending: pendingOf({}), withClustering: true });
    const files = computeClusters(ctx.snapshot.units, ctx.snapshot.edges).groups.values().next().value!;
    await mergeSemantics({ ctx, root: orderlyRoot, pending: pendingOf({ layers: { l: { name: "Core", files, ...narration } } }), withClustering: true });

    const record = readAuthoredRecord(scvDir, "sha");
    expect(Object.keys(record.layers!.entry)).toEqual([layerIdFor(files)]);
    expect(record.layers!.entry[layerIdFor(files)]!.name).toBe("Core");
    expect(record.layers!.fingerprint).toBe(evaluate(inputs(), record, emptyAuthoredSet()).layers.fingerprint);
  });

  it("refuses a committed store that resolves outside the repo", async () => {
    const fx = gitFixture({ files: { "m.py": "def a():\n    return 1\n" } });
    try {
      const outside = path.join(path.dirname(fx.root), "outside");
      mkdirSync(path.join(outside, "semantics"), { recursive: true });
      symlinkSync(outside, path.join(fx.root, ".scv"));
      await expect(mergeInto(fx, {})).rejects.toThrow(/outside/);
    } finally {
      fx.cleanup();
    }
  });
});

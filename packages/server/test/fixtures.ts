import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Delta, Snapshot } from "@semviz/schema";

export function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    schema: "scv/1",
    snapshot_id: "snap-1",
    repo: { root: "orderly", vcs: "git" },
    rev: { sha: "a".repeat(40), kind: "commit", ts: "2026-01-01T00:00:00Z", author: "Ada", author_kind: "human" },
    provenance: { extractor: "scv-ts/0.1.0", interpreter: { model: "none", prompt_rev: "none" } },
    units: [
      {
        id: "unit:orders",
        kind: "module",
        name: "orders",
        qualname: "orders",
        parent: null,
        children: [],
        loc: { files: ["src/orders.ts"], start: 1, end: 10, sloc: 10 },
        tags: [],
        metrics: {},
        hash: { struct: null, text: null, semantic: null },
        provenance: { source: "static" },
      },
      {
        id: "unit:billing",
        kind: "module",
        name: "billing",
        qualname: "billing",
        parent: null,
        children: [],
        loc: { files: ["src/billing.ts"], start: 1, end: 20, sloc: 20 },
        tags: [],
        metrics: {},
        hash: { struct: null, text: null, semantic: null },
        provenance: { source: "static" },
      },
    ],
    edges: [
      {
        id: "edge:1",
        from: "unit:orders",
        to: "unit:billing",
        kind: "calls",
        weight: 1,
        source: "static",
        confidence: 1,
      },
    ],
    externals: [],
    ...overrides,
  };
}

export function makeDelta(overrides: Partial<Delta> = {}): Delta {
  return {
    schema: "scv-delta/1",
    from: { snapshot_id: "snap-1", sha: "a".repeat(40) },
    to: { snapshot_id: "snap-2", sha: "b".repeat(40) },
    provenance: { extractor: "scv-ts/0.1.0", interpreter: { model: "none", prompt_rev: "none" }, formulas: {} },
    inspect_queue: [
      { rank: 1, unit: "unit:billing", qualname: "billing", status: "modified", risk: 0.6, confidence: 0.8 },
    ],
    unit_deltas: [
      {
        unit: "unit:billing",
        qualname: "billing",
        kind: "module",
        status: "modified",
        fields: ["semantics"],
        amount: 0.4,
        blast_radius: { direct: 1, transitive: 1, public_api: false },
        authors: [],
        risk: { score: 0.6, axes: null, why: null, confidence: 0.8, source: "formula" },
      },
    ],
    edge_deltas: [],
    rollup: {},
    ...overrides,
  };
}

/** Writes snapshot fixture files into a fresh tmp `.scv/snapshots/` dir and returns the scvDir. */
export function writeScvFixture(snapshots: Snapshot[], deltas: Delta[] = []): string {
  const root = mkdtempSync(path.join(tmpdir(), "scv-server-test-"));
  const scvDir = path.join(root, ".scv");
  const snapshotsDir = path.join(scvDir, "snapshots");
  mkdirSync(snapshotsDir, { recursive: true });
  for (const snapshot of snapshots) {
    writeFileSync(path.join(snapshotsDir, `${snapshot.rev.sha}.json`), JSON.stringify(snapshot, null, 2));
  }
  if (deltas.length > 0) {
    const deltasDir = path.join(scvDir, "deltas");
    mkdirSync(deltasDir, { recursive: true });
    for (const delta of deltas) {
      writeFileSync(path.join(deltasDir, `${delta.from.sha}__${delta.to.sha}.json`), JSON.stringify(delta, null, 2));
    }
  }
  return scvDir;
}

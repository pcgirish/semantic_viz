import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Snapshot } from "@scv/schema";

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

/** Writes snapshot fixture files into a fresh tmp `.scv/snapshots/` dir and returns the scvDir. */
export function writeScvFixture(snapshots: Snapshot[]): string {
  const root = mkdtempSync(path.join(tmpdir(), "scv-server-test-"));
  const scvDir = path.join(root, ".scv");
  const snapshotsDir = path.join(scvDir, "snapshots");
  mkdirSync(snapshotsDir, { recursive: true });
  for (const snapshot of snapshots) {
    writeFileSync(path.join(snapshotsDir, `${snapshot.rev.sha}.json`), JSON.stringify(snapshot, null, 2));
  }
  return scvDir;
}

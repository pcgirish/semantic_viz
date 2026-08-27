import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SnapshotStore } from "../src/store.js";
import { makeSnapshot, writeScvFixture } from "./fixtures.js";

describe("SnapshotStore", () => {
  it("lists revs sorted newest first", () => {
    const older = makeSnapshot({ rev: { sha: "b".repeat(40), kind: "commit", ts: "2026-01-01T00:00:00Z", author: "Ada", author_kind: "human" } });
    const newer = makeSnapshot({ rev: { sha: "c".repeat(40), kind: "commit", ts: "2026-02-01T00:00:00Z", author: "Bo", author_kind: "human" } });
    const scvDir = writeScvFixture([older, newer]);
    const store = new SnapshotStore(scvDir);

    const revs = store.listRevs();

    expect(revs).toEqual([
      { sha: "c".repeat(40), kind: "commit", ts: "2026-02-01T00:00:00Z", author: "Bo", author_kind: "human", amount: 0 },
      { sha: "b".repeat(40), kind: "commit", ts: "2026-01-01T00:00:00Z", author: "Ada", author_kind: "human", amount: 0 },
    ]);
  });

  it("names a snapshot whose repo root is a placeholder after the served directory", () => {
    // `scv analyze .` used to store `path.basename(".")` — literally "." — so the UI had no
    // project name to show. The server knows the real root: it is the parent of the .scv dir.
    const stale = makeSnapshot({ repo: { root: ".", vcs: "git" } });
    const scvDir = writeScvFixture([stale]);
    const store = new SnapshotStore(scvDir);

    const served = store.getSnapshot("a".repeat(40));

    expect(served?.repo.root).toBe(path.basename(path.dirname(scvDir)));
  });

  it("leaves a real repo root recorded in the snapshot alone", () => {
    const scvDir = writeScvFixture([makeSnapshot({ repo: { root: "orderly", vcs: "git" } })]);
    const store = new SnapshotStore(scvDir);

    expect(store.getSnapshot("a".repeat(40))?.repo.root).toBe("orderly");
  });

  it("carries rev.pr through so revs can be grouped by pull request", () => {
    const withPr = makeSnapshot({ rev: { sha: "d".repeat(40), kind: "pr", pr: 412, ts: "2026-03-01T00:00:00Z", author: "Ada", author_kind: "human" } });
    const scvDir = writeScvFixture([withPr]);
    const store = new SnapshotStore(scvDir);

    expect(store.listRevs()).toEqual([
      { sha: "d".repeat(40), kind: "pr", pr: 412, ts: "2026-03-01T00:00:00Z", author: "Ada", author_kind: "human", amount: 0 },
    ]);
  });

  it("carries rev.message through so the Replay track can show what each commit did", () => {
    const withMessage = makeSnapshot({
      rev: { sha: "e".repeat(40), kind: "commit", message: "tune default rate limits", ts: "2026-03-01T00:00:00Z", author: "Ada", author_kind: "human" },
    });
    const scvDir = writeScvFixture([withMessage]);
    const store = new SnapshotStore(scvDir);

    expect(store.listRevs()).toEqual([
      { sha: "e".repeat(40), kind: "commit", message: "tune default rate limits", ts: "2026-03-01T00:00:00Z", author: "Ada", author_kind: "human", amount: 0 },
    ]);
  });

  it("returns an empty list when no snapshots exist", () => {
    const scvDir = writeScvFixture([]);
    const store = new SnapshotStore(scvDir);

    expect(store.listRevs()).toEqual([]);
  });

  it("gets a snapshot by sha", () => {
    const snapshot = makeSnapshot();
    const scvDir = writeScvFixture([snapshot]);
    const store = new SnapshotStore(scvDir);

    expect(store.getSnapshot(snapshot.rev.sha)).toEqual(snapshot);
  });

  it("returns undefined for an unknown sha", () => {
    const scvDir = writeScvFixture([makeSnapshot()]);
    const store = new SnapshotStore(scvDir);

    expect(store.getSnapshot("f".repeat(40))).toBeUndefined();
  });

  it("gets a unit with resolved neighbours", () => {
    const snapshot = makeSnapshot();
    const scvDir = writeScvFixture([snapshot]);
    const store = new SnapshotStore(scvDir);

    const result = store.getUnit(snapshot.rev.sha, "unit:orders");

    expect(result?.unit.id).toBe("unit:orders");
    expect(result?.neighbours).toEqual([snapshot.units[1]]);
  });

  it("returns undefined for an unknown unit id", () => {
    const snapshot = makeSnapshot();
    const scvDir = writeScvFixture([snapshot]);
    const store = new SnapshotStore(scvDir);

    expect(store.getUnit(snapshot.rev.sha, "unit:missing")).toBeUndefined();
  });

  it("searches units by qualname substring, case-insensitive", () => {
    const snapshot = makeSnapshot();
    const scvDir = writeScvFixture([snapshot]);
    const store = new SnapshotStore(scvDir);

    const results = store.search(snapshot.rev.sha, "BILL");

    expect(results.map((u) => u.id)).toEqual(["unit:billing"]);
  });

  it("returns undefined for a layout that was never saved", () => {
    const scvDir = writeScvFixture([makeSnapshot()]);
    const store = new SnapshotStore(scvDir);

    expect(store.getLayout("a".repeat(40), "tiles")).toBeUndefined();
  });

  it("round-trips a saved layout's node positions, keyed by sha and skin", () => {
    const scvDir = writeScvFixture([makeSnapshot()]);
    const store = new SnapshotStore(scvDir);
    const layout = { nodeX: { "unit:orders": 0, "unit:billing": 120 } };

    store.saveLayout("a".repeat(40), "tiles", layout);

    expect(store.getLayout("a".repeat(40), "tiles")).toEqual(layout);
  });

  it("keeps layouts for different skins of the same sha separate", () => {
    const scvDir = writeScvFixture([makeSnapshot()]);
    const store = new SnapshotStore(scvDir);

    store.saveLayout("a".repeat(40), "tiles", { nodeX: { a: 0 } });
    store.saveLayout("a".repeat(40), "tiles3d", { nodeX: { a: 200 } });

    expect(store.getLayout("a".repeat(40), "tiles")).toEqual({ nodeX: { a: 0 } });
    expect(store.getLayout("a".repeat(40), "tiles3d")).toEqual({ nodeX: { a: 200 } });
  });

  describe("invariant findings on load", () => {
    it("still serves a snapshot whose hierarchy predates the root policy, logging what it found", () => {
      // Every snapshot written before Phase 1 has orphan modules and often no system unit at all.
      // Refusing them would make the server unable to serve any history the repo already has, so
      // load logs and serves; analyze-time is where a hierarchy defect is a bug.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const scvDir = writeScvFixture([makeSnapshot()]);
      const store = new SnapshotStore(scvDir);

      expect(store.getSnapshot("a".repeat(40))).toBeDefined();
      expect(warn).toHaveBeenCalled();
      expect(warn.mock.calls.flat().join(" ")).toMatch(/orphan|no_root/);
      warn.mockRestore();
    });

    it("logs nothing for a snapshot that satisfies its invariants", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const healthy = makeSnapshot({
        units: [
          {
            id: "unit:system",
            kind: "system",
            name: "orderly",
            qualname: "orderly",
            parent: null,
            children: ["unit:orders"],
            loc: { files: [], start: null, end: null, sloc: 0 },
            tags: [],
            metrics: {},
            hash: { struct: null, text: null, semantic: null },
            provenance: { source: "static" },
          },
          {
            id: "unit:orders",
            kind: "module",
            name: "orders",
            qualname: "orders",
            parent: "unit:system",
            children: [],
            loc: { files: ["src/orders.ts"], start: 1, end: 10, sloc: 10 },
            tags: [],
            metrics: {},
            hash: { struct: null, text: null, semantic: null },
            provenance: { source: "static" },
          },
        ],
        edges: [],
      });
      const store = new SnapshotStore(writeScvFixture([healthy]));

      expect(store.getSnapshot("a".repeat(40))).toBeDefined();
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});

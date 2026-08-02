import { describe, expect, it } from "vitest";
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

  it("carries rev.pr through so revs can be grouped by pull request", () => {
    const withPr = makeSnapshot({ rev: { sha: "d".repeat(40), kind: "pr", pr: 412, ts: "2026-03-01T00:00:00Z", author: "Ada", author_kind: "human" } });
    const scvDir = writeScvFixture([withPr]);
    const store = new SnapshotStore(scvDir);

    expect(store.listRevs()).toEqual([
      { sha: "d".repeat(40), kind: "pr", pr: 412, ts: "2026-03-01T00:00:00Z", author: "Ada", author_kind: "human", amount: 0 },
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
});

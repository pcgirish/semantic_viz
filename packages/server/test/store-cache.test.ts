import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SnapshotStore } from "../src/store.js";
import { makeSnapshot, writeScvFixture } from "./fixtures.js";

describe("SnapshotStore caching", () => {
  it("parses each snapshot file once across repeated reads", () => {
    const scvDir = writeScvFixture([makeSnapshot()]);
    const store = new SnapshotStore(scvDir);
    const parse = vi.spyOn(JSON, "parse");

    store.listRevs();
    const afterFirst = parse.mock.calls.length;
    store.listRevs();
    store.getSnapshot(makeSnapshot().rev.sha);

    // Only the mtime/size stat survey runs on the later calls; no re-parse.
    expect(parse.mock.calls.length).toBe(afterFirst);
    parse.mockRestore();
  });

  it("re-reads a snapshot after its file changes on disk", () => {
    const original = makeSnapshot();
    const scvDir = writeScvFixture([original]);
    const store = new SnapshotStore(scvDir);
    expect(store.getSnapshot(original.rev.sha)?.units.length).toBe(original.units.length);

    const file = path.join(scvDir, "snapshots", `${original.rev.sha}.json`);
    const edited = JSON.parse(readFileSync(file, "utf-8"));
    edited.units = [];
    writeFileSync(file, JSON.stringify(edited));

    expect(store.getSnapshot(original.rev.sha)?.units.length).toBe(0);
  });
});

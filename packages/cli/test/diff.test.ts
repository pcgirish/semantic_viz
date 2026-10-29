import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider, ProviderResult } from "@semviz/interpreter";
import type { Snapshot } from "@semviz/schema";
import { runDiff } from "../src/diff.js";

function makeSnapshot(sha: string, units: Snapshot["units"] = []): Snapshot {
  return {
    schema: "scv/1",
    snapshot_id: `snap-${sha}`,
    repo: { root: "orderly", vcs: "git" },
    rev: { sha, kind: "commit", author: "a", author_kind: "human", ts: "2026-01-01T00:00:00Z" },
    provenance: { extractor: "scv-ts/0.1.0", interpreter: { model: "none", prompt_rev: "none" } },
    units,
    edges: [],
    externals: [],
  };
}

function fakeProvider(): Provider {
  return {
    name: "fake",
    model: "fake-model",
    interpret: vi.fn(async (): Promise<ProviderResult> => ({ text: JSON.stringify({ ranked: [] }), tokens: 1 })),
  };
}

describe("runDiff", () => {
  let scvDir: string;

  beforeEach(() => {
    scvDir = mkdtempSync(path.join(tmpdir(), "scv-diff-"));
    mkdirSync(path.join(scvDir, "snapshots"), { recursive: true });
  });

  afterEach(() => {
    rmSync(scvDir, { recursive: true, force: true });
  });

  it("reads two snapshots by sha, diffs them, and writes a delta file", async () => {
    writeFileSync(path.join(scvDir, "snapshots", "aaa1111.json"), JSON.stringify(makeSnapshot("aaa1111")));
    writeFileSync(path.join(scvDir, "snapshots", "bbb2222.json"), JSON.stringify(makeSnapshot("bbb2222")));

    const written = await runDiff({ scvDir, from: "aaa1111", to: "bbb2222", provider: fakeProvider(), promptRev: "p1" });

    const contents = JSON.parse(readFileSync(written.path, "utf-8"));
    expect(contents.schema).toBe("scv-delta/1");
    expect(contents.from.sha).toBe("aaa1111");
    expect(contents.to.sha).toBe("bbb2222");
    expect(written.path).toBe(path.join(scvDir, "deltas", "aaa1111__bbb2222.json"));
  });

  it("throws a clear error when a referenced snapshot does not exist", async () => {
    writeFileSync(path.join(scvDir, "snapshots", "aaa1111.json"), JSON.stringify(makeSnapshot("aaa1111")));

    await expect(
      runDiff({ scvDir, from: "aaa1111", to: "missing", provider: fakeProvider(), promptRev: "p1" }),
    ).rejects.toThrow(/missing/);
  });
});

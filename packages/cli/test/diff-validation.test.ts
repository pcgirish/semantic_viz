import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDiff } from "../src/diff.js";

describe("runDiff snapshot validation", () => {
  let scvDir: string;

  beforeEach(() => {
    scvDir = mkdtempSync(path.join(tmpdir(), "scv-diff-"));
    mkdirSync(path.join(scvDir, "snapshots"), { recursive: true });
  });

  afterEach(() => {
    rmSync(scvDir, { recursive: true, force: true });
  });

  function writeSnapshot(sha: string, body: unknown): void {
    writeFileSync(path.join(scvDir, "snapshots", `${sha}.json`), JSON.stringify(body));
  }

  it("names the offending file and field when a snapshot does not match scv/1", async () => {
    // A plausible-looking but truncated snapshot: right schema tag, `units` missing entirely.
    writeSnapshot("aaa", { schema: "scv/1", snapshot_id: "s1", rev: { sha: "aaa" } });
    writeSnapshot("bbb", { schema: "scv/1", snapshot_id: "s2", rev: { sha: "bbb" } });
    await expect(runDiff({ scvDir, from: "aaa", to: "bbb" })).rejects.toThrow(/aaa\.json.*schema/s);
  });

  it("names the offending file when a snapshot is not valid JSON", async () => {
    writeFileSync(path.join(scvDir, "snapshots", "aaa.json"), "{ truncated");
    writeSnapshot("bbb", { schema: "scv/1", snapshot_id: "s2", rev: { sha: "bbb" } });
    await expect(runDiff({ scvDir, from: "aaa", to: "bbb" })).rejects.toThrow(/aaa\.json.*JSON/s);
  });
});

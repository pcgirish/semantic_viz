import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider, ProviderResult } from "@scv/interpreter";
import type { Snapshot } from "@scv/schema";
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

/** A system root with one module under it — the minimum that satisfies the tree invariants. */
function healthyUnits(): Snapshot["units"] {
  return [
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
  ];
}

function fakeProvider(): Provider {
  return {
    name: "fake",
    model: "fake-model",
    interpret: vi.fn(async (): Promise<ProviderResult> => ({ text: JSON.stringify({ ranked: [] }), tokens: 1 })),
  };
}

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

  it("still diffs a snapshot whose hierarchy predates the root policy, logging what it found", async () => {
    // Same tension as the server: every revision analyzed before Phase 1 has orphan modules and
    // often no system unit, so refusing would break `scv diff` across all existing history. The
    // schema stays the trust boundary; a hierarchy defect on disk is an observation, not a refusal.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeSnapshot("aaa1111", makeSnapshot("aaa1111"));
    writeSnapshot("bbb2222", makeSnapshot("bbb2222"));

    const written = await runDiff({ scvDir, from: "aaa1111", to: "bbb2222", provider: fakeProvider(), promptRev: "p1" });

    expect(written.delta.schema).toBe("scv-delta/1");
    expect(warn.mock.calls.flat().join(" ")).toMatch(/no_root/);
    warn.mockRestore();
  });

  it("logs nothing for a snapshot that satisfies its invariants", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeSnapshot("aaa1111", makeSnapshot("aaa1111", healthyUnits()));
    writeSnapshot("bbb2222", makeSnapshot("bbb2222", healthyUnits()));

    await runDiff({ scvDir, from: "aaa1111", to: "bbb2222", provider: fakeProvider(), promptRev: "p1" });

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

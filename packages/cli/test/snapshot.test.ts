import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractRepo } from "@semviz/extractor";
import { toSnapshot } from "../src/snapshot.js";

const orderlyRoot = fileURLToPath(new URL("../../../fixtures/orderly", import.meta.url));

describe("toSnapshot", () => {
  const graph = extractRepo(orderlyRoot);
  const rev = { sha: "abc123", kind: "commit" as const, ts: "2024-01-01T00:00:00Z", author: "j.moreau", author_kind: "human" };
  const snapshot = toSnapshot(graph, { root: orderlyRoot, rev, repoName: "orderly" });

  it("stamps the scv/1 schema and snapshot_id derived from repo+rev", () => {
    expect(snapshot.schema).toBe("scv/1");
    expect(snapshot.snapshot_id).toMatch(/^[0-9a-f]{12,}$/);
  });

  it("carries repo root and rev through unchanged", () => {
    expect(snapshot.repo.root).toBe("orderly");
    expect(snapshot.repo.vcs).toBe("git");
    expect(snapshot.rev).toEqual(rev);
  });

  it("names the repo after the resolved directory when analyzing a relative root", () => {
    // `path.basename(".")` is "."; analyzing the cwd must still yield the directory's real name.
    const relative = toSnapshot(graph, { root: ".", rev });
    expect(relative.repo.root).toBe(path.basename(process.cwd()));
  });

  it("maps every SymbolUnit to a Unit with semantics/signature/cost null (not yet lifted)", () => {
    expect(snapshot.units.length).toBe(graph.units.length);
    for (const unit of snapshot.units) {
      expect(unit.semantics).toBeNull();
      expect(unit.signature).toBeNull();
      expect(unit.cost).toBeNull();
      expect(unit.provenance.source).toBe("static");
    }
  });

  it("maps kind, ids, hierarchy, loc.sloc and metrics for a known unit", () => {
    const unit = snapshot.units.find((u) => u.qualname.endsWith("rate_limit"));
    expect(unit).toBeDefined();
    expect(unit?.kind).toBe("function");
    expect(unit?.loc.sloc).toBeGreaterThan(0);
    expect(unit?.metrics.fan_in).toBeGreaterThanOrEqual(0);
    expect(unit?.hash.struct).toBeTruthy();
    expect(unit?.hash.semantic).toBeNull();
  });

  it("maps every SymbolEdge to an Edge with source:static and confidence carried through", () => {
    expect(snapshot.edges.length).toBe(graph.edges.length);
    for (const edge of snapshot.edges) {
      expect(edge.source).toBe("static");
    }
  });

  it("maps externals with reached_by renamed from reachedBy", () => {
    expect(snapshot.externals.length).toBe(graph.externals.length);
    for (const ext of snapshot.externals) {
      expect(Array.isArray(ext.reached_by)).toBe(true);
    }
  });

  it("is valid against SnapshotSchema", async () => {
    const { SnapshotSchema } = await import("@semviz/schema");
    expect(() => SnapshotSchema.parse(snapshot)).not.toThrow();
  });
});

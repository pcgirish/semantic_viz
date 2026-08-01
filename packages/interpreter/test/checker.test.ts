import { describe, expect, it } from "vitest";
import { checkAndRepairClusters, directoryClusters, modularity } from "../src/checker.js";
import type { ImportEdge } from "../src/checker.js";

const files = ["src/api/routes.py", "src/api/middleware/rate_limiter.py", "src/admin_tasks.py", "scripts/backfill.py"];

describe("directoryClusters", () => {
  it("groups files by their parent directory", () => {
    const clusters = directoryClusters(files);
    expect(clusters).toEqual({
      "src/api": ["src/api/routes.py"],
      "src/api/middleware": ["src/api/middleware/rate_limiter.py"],
      src: ["src/admin_tasks.py"],
      scripts: ["scripts/backfill.py"],
    });
  });
});

describe("checkAndRepairClusters", () => {
  it("returns the proposal unchanged when it already partitions every file", () => {
    const proposal = { ops: ["src/admin_tasks.py", "scripts/backfill.py"], api: ["src/api/routes.py", "src/api/middleware/rate_limiter.py"] };
    const result = checkAndRepairClusters(proposal, files);
    expect(result.clusters).toEqual(proposal);
    expect(result.repaired).toBe(false);
  });

  it("adds orphaned files not mentioned by the LLM into a fallback cluster", () => {
    const proposal = { ops: ["src/admin_tasks.py"] };
    const result = checkAndRepairClusters(proposal, files);
    expect(result.repaired).toBe(true);
    expect(result.clusters.ops).toEqual(["src/admin_tasks.py"]);
    expect(result.clusters.unclustered).toEqual(
      expect.arrayContaining(["src/api/routes.py", "src/api/middleware/rate_limiter.py", "scripts/backfill.py"]),
    );
  });

  it("keeps a duplicated file in the first cluster that claims it, drops later duplicates", () => {
    const proposal = { a: ["src/admin_tasks.py", "scripts/backfill.py"], b: ["scripts/backfill.py"] };
    const result = checkAndRepairClusters(proposal, ["src/admin_tasks.py", "scripts/backfill.py"]);
    expect(result.repaired).toBe(true);
    expect(result.clusters.a).toEqual(["src/admin_tasks.py", "scripts/backfill.py"]);
    expect(result.clusters.b).toBeUndefined();
  });

  it("drops files the LLM invented that aren't in the real file list", () => {
    const proposal = { ops: ["src/admin_tasks.py", "scripts/backfill.py", "src/does_not_exist.py"] };
    const result = checkAndRepairClusters(proposal, ["src/admin_tasks.py", "scripts/backfill.py"]);
    expect(result.repaired).toBe(true);
    expect(result.clusters.ops).toEqual(["src/admin_tasks.py", "scripts/backfill.py"]);
  });

  it("drops clusters left empty after repair", () => {
    const proposal = { ops: ["src/does_not_exist.py"], other: ["src/admin_tasks.py"] };
    const result = checkAndRepairClusters(proposal, ["src/admin_tasks.py"]);
    expect(result.clusters.ops).toBeUndefined();
    expect(result.clusters.other).toEqual(["src/admin_tasks.py"]);
  });
});

describe("modularity", () => {
  const edges: ImportEdge[] = [
    { from: "src/admin_tasks.py", to: "scripts/backfill.py", weight: 1 },
    { from: "src/api/routes.py", to: "src/api/middleware/rate_limiter.py", weight: 1 },
  ];

  it("scores 1 when every edge stays inside its cluster", () => {
    const clusters = { ops: ["src/admin_tasks.py", "scripts/backfill.py"], api: ["src/api/routes.py", "src/api/middleware/rate_limiter.py"] };
    expect(modularity(clusters, edges)).toBe(1);
  });

  it("scores lower when directory-shaped grouping splits a cohesive import pair", () => {
    const dirClusters = directoryClusters(files);
    const opsClusters = { ops: ["src/admin_tasks.py", "scripts/backfill.py"], api: ["src/api/routes.py", "src/api/middleware/rate_limiter.py"] };

    const dirScore = modularity(dirClusters, edges);
    const opsScore = modularity(opsClusters, edges);

    expect(opsScore).toBeGreaterThan(dirScore);
  });

  it("scores 0 for an empty edge list", () => {
    expect(modularity({ a: ["x"] }, [])).toBe(0);
  });
});

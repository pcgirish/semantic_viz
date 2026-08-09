import { describe, expect, it } from "vitest";
import { checkAndRepairClusters, directoryClusters, MAX_BRANCH_DEPTH, MAX_FAN_OUT, modularity, traceFlow, traceFlowBranching } from "../src/checker.js";
import type { CallEdge, ImportEdge } from "../src/checker.js";

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

describe("traceFlow", () => {
  const known = new Set(["a", "b", "c", "d", "e"]);

  it("traces the single longest path from an entry unit through calls edges", () => {
    const edges: CallEdge[] = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "d" },
    ];
    expect(traceFlow("a", known, edges)).toEqual(["a", "b", "c", "d"]);
  });

  it("stops at a leaf with no outgoing calls edges", () => {
    const edges: CallEdge[] = [{ from: "a", to: "b" }];
    expect(traceFlow("a", known, edges)).toEqual(["a", "b"]);
  });

  it("does not infinite-loop on a cycle", () => {
    const edges: CallEdge[] = [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
    ];
    expect(traceFlow("a", known, edges)).toEqual(["a", "b"]);
  });

  it("picks the longer of two branches, not the first-seen", () => {
    const edges: CallEdge[] = [
      { from: "a", to: "b" },
      { from: "a", to: "c" },
      { from: "c", to: "d" },
      { from: "d", to: "e" },
    ];
    expect(traceFlow("a", known, edges)).toEqual(["a", "c", "d", "e"]);
  });

  it("returns null for an entry unit id not in the known set", () => {
    expect(traceFlow("ghost", known, [])).toBeNull();
  });
});

describe("traceFlowBranching", () => {
  const known = new Set(["a", "b", "c", "d", "e", "f"]);

  it("returns a single-child chain for a linear flow, matching traceFlow's path", () => {
    const edges: CallEdge[] = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ];
    expect(traceFlowBranching("a", known, edges)).toEqual({
      unit: "a",
      children: [{ unit: "b", children: [{ unit: "c", children: [] }] }],
    });
  });

  it("keeps every branch at a fan-out, unlike traceFlow's longest-only walk", () => {
    const edges: CallEdge[] = [
      { from: "a", to: "b", label: "success" },
      { from: "a", to: "c", label: "failure" },
    ];
    const result = traceFlowBranching("a", known, edges);
    expect(result?.children).toEqual(
      expect.arrayContaining([
        { unit: "b", label: "success", children: [] },
        { unit: "c", label: "failure", children: [] },
      ]),
    );
    expect(result?.children).toHaveLength(2);
  });

  it(`truncates fan-out beyond MAX_FAN_OUT (${MAX_FAN_OUT}) deterministically, keeping the first-seen edges`, () => {
    const edges: CallEdge[] = [
      { from: "a", to: "b" },
      { from: "a", to: "c" },
      { from: "a", to: "d" },
      { from: "a", to: "e" },
    ];
    const result = traceFlowBranching("a", known, edges);
    expect(result?.children).toHaveLength(MAX_FAN_OUT);
    expect(result?.children?.map((c) => c.unit)).toEqual(["b", "c", "d"]);
  });

  it(`stops recursing past MAX_BRANCH_DEPTH (${MAX_BRANCH_DEPTH}) hops from the entry`, () => {
    const deepKnown = new Set(["a", "b", "c", "d", "e", "f", "g"]);
    const edges: CallEdge[] = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "d" },
      { from: "d", to: "e" },
      { from: "e", to: "f" },
      { from: "f", to: "g" },
    ];
    let node = traceFlowBranching("a", deepKnown, edges);
    let depth = 0;
    while (node?.children?.length) {
      node = node.children[0]!;
      depth += 1;
    }
    expect(depth).toBeLessThanOrEqual(MAX_BRANCH_DEPTH);
  });

  it("does not infinite-loop on a cycle", () => {
    const edges: CallEdge[] = [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
    ];
    expect(traceFlowBranching("a", known, edges)).toEqual({
      unit: "a",
      children: [{ unit: "b", children: [] }],
    });
  });

  it("returns null for an entry unit id not in the known set", () => {
    expect(traceFlowBranching("ghost", known, [])).toBeNull();
  });
});

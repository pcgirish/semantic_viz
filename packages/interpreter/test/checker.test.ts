import { describe, expect, it } from "vitest";
import { checkAndRepairClusters, directoryClusters, MAX_BRANCH_DEPTH, MAX_FAN_OUT, modularity, normalizeClusterName, traceFlow, traceFlowBranching } from "../src/checker.js";
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

  it("names the root cluster 'root' rather than '.', which renders as a tile literally labelled '.'", () => {
    // A root-level file has no slash, so the parent directory is the repo root. Naming it "."
    // is what puts a tile labelled "." on the canvas (observed in fixtures/orderly groups.json).
    const clusters = directoryClusters(["setup.py", "src/app.py"]);
    expect(clusters["."]).toBeUndefined();
    expect(clusters.root).toEqual(["setup.py"]);
  });
});

describe("normalizeClusterName", () => {
  it.each([
    ["billing_cluster", "billing"],
    ["api_layer", "api"],
    ["orders_module", "orders"],
    ["auth_component", "auth"],
    ["payments_core", "payments"],
    ["shipping_domain", "shipping"],
  ])("strips the banned architecture-speak suffix in %s", (input, expected) => {
    expect(normalizeClusterName(input)).toBe(expected);
  });

  it.each([
    ["kebab-case", "OrderProcessing", "order_processing"],
    ["kebab input", "order-processing", "order_processing"],
    ["spaces", "Order Processing", "order_processing"],
    ["screaming", "ORDERS", "orders"],
  ])("canonicalizes %s to snake_case", (_label, input, expected) => {
    expect(normalizeClusterName(input)).toBe(expected);
  });

  it("strips a banned suffix that is separated by a dash or space, not only an underscore", () => {
    expect(normalizeClusterName("api-layer")).toBe("api");
    expect(normalizeClusterName("api layer")).toBe("api");
  });

  it("keeps a name whose banned word is not a suffix but the whole name, since stripping leaves nothing", () => {
    // "layer" alone has no other token to fall back on — dropping it would produce "".
    expect(normalizeClusterName("layer")).toBe("layer");
  });

  it("strips only the trailing banned token, not a banned word embedded mid-name", () => {
    expect(normalizeClusterName("core_banking")).toBe("core_banking");
  });

  it("leaves an already-clean name untouched", () => {
    expect(normalizeClusterName("billing")).toBe("billing");
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

  it("renames a cluster whose name collides with one of its own members, to avoid a self-nesting tile", () => {
    // Pass C groups layers (not files) into groups; a group literally named "orders" that
    // contains a member also named "orders" renders as "orders" nested inside "orders".
    const proposal = { orders: ["orders", "payments", "utils"], platform: ["api", "migrations"] };
    const result = checkAndRepairClusters(proposal, ["orders", "payments", "utils", "api", "migrations"]);
    expect(result.repaired).toBe(true);
    expect(result.clusters.orders).toBeUndefined();
    expect(result.clusters.orders_group).toEqual(["orders", "payments", "utils"]);
    expect(result.clusters.platform).toEqual(["api", "migrations"]);
  });
});

describe("checkAndRepairClusters name normalization", () => {
  it("strips banned suffixes from cluster names and flags the proposal as repaired", () => {
    const proposal = { api_layer: ["a.py"], billing_cluster: ["b.py"] };
    const result = checkAndRepairClusters(proposal, ["a.py", "b.py"]);
    expect(result.repaired).toBe(true);
    expect(Object.keys(result.clusters).sort()).toEqual(["api", "billing"]);
  });

  it("canonicalizes mixed case conventions to one convention across the proposal", () => {
    const proposal = { "order-processing": ["a.py"], BillingEngine: ["b.py"] };
    const result = checkAndRepairClusters(proposal, ["a.py", "b.py"]);
    expect(Object.keys(result.clusters).sort()).toEqual(["billing_engine", "order_processing"]);
  });

  it("merges two clusters that normalize to the same name rather than dropping one", () => {
    // "api_layer" and "api" both normalize to "api"; the files from both must survive.
    const proposal = { api_layer: ["a.py"], api: ["b.py"] };
    const result = checkAndRepairClusters(proposal, ["a.py", "b.py"]);
    expect(result.repaired).toBe(true);
    expect(result.clusters.api?.sort()).toEqual(["a.py", "b.py"]);
  });

  it("still breaks a name-equals-member collision created by normalization itself", () => {
    // "orders_layer" normalizes to "orders", which then collides with its own member "orders".
    const proposal = { orders_layer: ["orders", "payments"] };
    const result = checkAndRepairClusters(proposal, ["orders", "payments"]);
    expect(result.clusters.orders).toBeUndefined();
    expect(result.clusters.orders_group).toEqual(["orders", "payments"]);
  });

  it("does not set repaired when every name is already normal", () => {
    const proposal = { api: ["a.py"], billing: ["b.py"] };
    const result = checkAndRepairClusters(proposal, ["a.py", "b.py"]);
    expect(result.repaired).toBe(false);
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

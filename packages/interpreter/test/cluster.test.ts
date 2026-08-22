import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLUSTERING_ALGORITHM,
  CLUSTERING_VERSION,
  MAX_CLUSTER_SHARE,
  MERGE_THRESHOLD,
  MIN_EDGE_WEIGHT,
  MIN_LARGE_REPO_FILES,
  RELATIVE_EDGE_RATIO,
  assertStrictPartition,
  clusterFiles,
  layerIdFor,
  resolveLayerNames,
  type ClusterGroups,
} from "../src/cluster.js";
import { directoryClusters, type ImportEdge } from "../src/checker.js";
import type { Layer } from "../src/pass-c.js";

/** Membership as a comparable value: sorted member lists, sorted among themselves. */
function partition(groups: ClusterGroups): string[][] {
  return [...groups.values()].map((files) => [...files].sort()).sort((a, b) => a[0]!.localeCompare(b[0]!));
}

/** Deterministic Fisher-Yates on a seeded LCG — a shuffle a test can reproduce on failure. */
function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let state = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const ADVERSARIAL_ROOT = join(__dirname, "../../../fixtures/cluster-quality-adversarial");

type Manifest = {
  files: string[];
  edges: ImportEdge[];
  expected: Record<string, string[]>;
  excluded: string[];
};

function manifest(): Manifest {
  return JSON.parse(readFileSync(join(ADVERSARIAL_ROOT, "manifest.json"), "utf8")) as Manifest;
}

describe("clusterFiles — determinism (criterion 1)", () => {
  it("yields byte-identical membership, ids, and Map iteration order across 100 shuffles", () => {
    const m = manifest();
    const files = m.files.filter((f) => !m.excluded.includes(f));
    const edges = m.edges.filter((e) => files.includes(e.from) && files.includes(e.to));

    const baseline = clusterFiles(files, edges);
    const baselineKeys = [...baseline.keys()];
    const baselineJson = JSON.stringify([...baseline]);

    for (let seed = 1; seed <= 100; seed++) {
      const groups = clusterFiles(shuffled(files, seed), shuffled(edges, seed * 7));
      // Iteration order is a separate property from membership: the Map is built in ascending
      // structural-id order so any serialization of it is byte-stable.
      expect([...groups.keys()], `seed ${seed} key order`).toEqual(baselineKeys);
      expect(JSON.stringify([...groups]), `seed ${seed} serialization`).toBe(baselineJson);
    }
  });

  it("sums duplicate same-direction edges", () => {
    const files = ["a.py", "b.py"];
    const split = clusterFiles(files, [
      { from: "a.py", to: "b.py", weight: 1 },
      { from: "a.py", to: "b.py", weight: 1 },
    ]);
    const summed = clusterFiles(files, [{ from: "a.py", to: "b.py", weight: 2 }]);
    expect([...split]).toEqual([...summed]);
    // Weight 2 clears MIN_EDGE_WEIGHT and MERGE_THRESHOLD, so the two files merge.
    expect(partition(split)).toEqual([["a.py", "b.py"]]);
  });

  it("drops self-edges and edges with an endpoint outside `files`", () => {
    const files = ["a.py", "b.py"];
    const clean = clusterFiles(files, [{ from: "a.py", to: "b.py", weight: 3 }]);
    const noisy = clusterFiles(files, [
      { from: "a.py", to: "b.py", weight: 3 },
      { from: "a.py", to: "a.py", weight: 9 },
      { from: "a.py", to: "ghost.py", weight: 9 },
      { from: "ghost.py", to: "b.py", weight: 9 },
    ]);
    expect([...noisy]).toEqual([...clean]);
  });

  it("keys every group by layerIdFor of its own members", () => {
    const m = manifest();
    const files = m.files.filter((f) => !m.excluded.includes(f));
    const groups = clusterFiles(files, m.edges);
    for (const [id, members] of groups) expect(id).toBe(layerIdFor(members));
  });
});

describe("clusterFiles — deterministic fallback (criterion 3)", () => {
  it("falls back to directoryClusters, keyed by structural id, when retention leaves no edges", () => {
    // Every edge is weight 1 — below MIN_EDGE_WEIGHT — so nothing survives retention.
    const files = ["app/a.py", "app/b.py", "lib/c.py"];
    const edges: ImportEdge[] = [
      { from: "app/a.py", to: "lib/c.py", weight: 1 },
      { from: "app/b.py", to: "lib/c.py", weight: 1 },
    ];
    const groups = clusterFiles(files, edges);

    const expected = Object.values(directoryClusters(files)).map((f) => [...f].sort());
    expect(partition(groups)).toEqual(expected.sort((a, b) => a[0]!.localeCompare(b[0]!)));
    for (const [id, members] of groups) expect(id).toBe(layerIdFor(members));
  });

  it("is stable across shuffled input order in the fallback path", () => {
    const files = ["app/a.py", "app/b.py", "lib/c.py", "z.py"];
    const baseline = JSON.stringify([...clusterFiles(files, [])]);
    for (let seed = 1; seed <= 20; seed++) {
      expect(JSON.stringify([...clusterFiles(shuffled(files, seed), [])])).toBe(baseline);
    }
  });

  it("returns an empty result for an empty file list", () => {
    expect([...clusterFiles([], [])]).toEqual([]);
  });
});

describe("clusterFiles — named thresholds (criterion 4)", () => {
  it("retains an edge at exactly MIN_EDGE_WEIGHT and drops one below it", () => {
    const at = clusterFiles(["a.py", "b.py"], [{ from: "a.py", to: "b.py", weight: MIN_EDGE_WEIGHT }]);
    expect(partition(at)).toEqual([["a.py", "b.py"]]);

    const below = clusterFiles(["a.py", "b.py"], [{ from: "a.py", to: "b.py", weight: MIN_EDGE_WEIGHT - 1 }]);
    // No retained edges at all, so the directory fallback applies — both files sit at the root.
    expect(partition(below)).toEqual([["a.py", "b.py"]].map((f) => f));
  });

  it("takes max, not sum, across the two directions of a file pair", () => {
    // 1 + 1 would clear MIN_EDGE_WEIGHT; max(1, 1) does not. This is what keeps a high-fan-in
    // utility out of a cluster it is merely imported by.
    const groups = clusterFiles(["a.py", "b.py", "c.py"], [
      { from: "a.py", to: "b.py", weight: 1 },
      { from: "b.py", to: "a.py", weight: 1 },
      { from: "a.py", to: "c.py", weight: 3 },
      { from: "c.py", to: "a.py", weight: 3 },
    ]);
    expect(partition(groups)).toEqual([["a.py", "c.py"], ["b.py"]]);
  });

  it("drops an edge failing the relative threshold at only its second endpoint", () => {
    // hub.py has a weight-40 tie to core.py, so 0.25 * 40 = 10 > 3: the hub-leaf edge fails at
    // the hub end even though it is the leaf's strongest — and only-one-endpoint is enough.
    const files = ["hub.py", "core.py", "leaf.py"];
    const edges: ImportEdge[] = [
      { from: "hub.py", to: "core.py", weight: 40 },
      { from: "leaf.py", to: "hub.py", weight: 3 },
    ];
    expect(RELATIVE_EDGE_RATIO * 40).toBeGreaterThan(3);
    expect(partition(clusterFiles(files, edges))).toEqual([["core.py", "hub.py"], ["leaf.py"]]);
  });

  it("accepts a merge at exactly MERGE_THRESHOLD", () => {
    const groups = clusterFiles(["a.py", "b.py"], [{ from: "a.py", to: "b.py", weight: MERGE_THRESHOLD }]);
    expect(partition(groups)).toEqual([["a.py", "b.py"]]);
  });

  it("leaves the MAX_CLUSTER_SHARE cap inactive below MIN_LARGE_REPO_FILES", () => {
    // Six files, all one strongly-connected chain: 100% share, far above MAX_CLUSTER_SHARE.
    // Small repos are deliberately unbounded — a 25% cap on six files would forbid any cluster
    // above one file — and this test says so rather than implying a cap exists.
    const files = ["a.py", "b.py", "c.py", "d.py", "e.py", "f.py"];
    const edges = files.slice(0, -1).map((f, i) => ({ from: f, to: files[i + 1]!, weight: 5 }));
    expect(files.length).toBeLessThan(MIN_LARGE_REPO_FILES);
    expect(partition(clusterFiles(files, edges))).toEqual([[...files].sort()]);
  });

  it("rejects a merge exceeding MAX_CLUSTER_SHARE once the repo is large enough", () => {
    // 24 files: a 12-file chain (50% > 25%) plus 12 unconnected files to pass MIN_LARGE_REPO_FILES.
    const chain = Array.from({ length: 12 }, (_, i) => `chain/f${String(i).padStart(2, "0")}.py`);
    const rest = Array.from({ length: 12 }, (_, i) => `rest/g${String(i).padStart(2, "0")}.py`);
    const files = [...chain, ...rest];
    const edges = chain.slice(0, -1).map((f, i) => ({ from: f, to: chain[i + 1]!, weight: 5 }));
    expect(files.length).toBeGreaterThanOrEqual(MIN_LARGE_REPO_FILES);

    const groups = clusterFiles(files, edges);
    const largest = Math.max(...[...groups.values()].map((g) => g.length));
    expect(largest).toBeLessThanOrEqual(Math.floor(files.length * MAX_CLUSTER_SHARE));
  });

  it("accepts a cluster at exactly MAX_CLUSTER_SHARE", () => {
    // 20 files, a 5-file chain: 5/20 = 0.25, exactly the cap, so the final merge is accepted.
    const chain = Array.from({ length: 5 }, (_, i) => `chain/f${i}.py`);
    const rest = Array.from({ length: 15 }, (_, i) => `rest/g${String(i).padStart(2, "0")}.py`);
    const files = [...chain, ...rest];
    const edges = chain.slice(0, -1).map((f, i) => ({ from: f, to: chain[i + 1]!, weight: 5 }));
    expect(files.length).toBe(MIN_LARGE_REPO_FILES);
    expect(chain.length / files.length).toBe(MAX_CLUSTER_SHARE);

    const groups = clusterFiles(files, edges);
    expect([...groups.values()].some((g) => g.length === chain.length)).toBe(true);
  });
});

describe("clusterFiles — accepted chaining", () => {
  it("merges two cohesive clusters joined by a single edge strong at both endpoints", () => {
    // This is single linkage's known weakness, accepted deliberately rather than mitigated: any
    // cohesion rule that would block it is the average-linkage failure this design corrects,
    // and would re-break the 4b billing case. The bridge edge is strong at both ends, which is
    // the same evidence that justifies the merge.
    const files = ["l/a.py", "l/b.py", "r/c.py", "r/d.py"];
    const edges: ImportEdge[] = [
      { from: "l/a.py", to: "l/b.py", weight: 4 },
      { from: "r/c.py", to: "r/d.py", weight: 4 },
      { from: "l/b.py", to: "r/c.py", weight: 4 },
    ];
    expect(partition(clusterFiles(files, edges))).toEqual([[...files].sort()]);
  });

  it("does not block that merge below MIN_LARGE_REPO_FILES", () => {
    const files = ["l/a.py", "l/b.py", "r/c.py", "r/d.py"];
    expect(files.length).toBeLessThan(MIN_LARGE_REPO_FILES);
    const groups = clusterFiles(files, [
      { from: "l/a.py", to: "l/b.py", weight: 4 },
      { from: "r/c.py", to: "r/d.py", weight: 4 },
      { from: "l/b.py", to: "r/c.py", weight: 4 },
    ]);
    expect(groups.size).toBe(1);
  });
});

describe("clusterFiles — growth is not over-promised", () => {
  const base: ImportEdge[] = [
    { from: "billing/a.py", to: "billing/b.py", weight: 4 },
    { from: "ship/c.py", to: "ship/d.py", weight: 4 },
  ];
  const baseFiles = ["billing/a.py", "billing/b.py", "ship/c.py", "ship/d.py"];

  it("leaves other clusters byte-identical when a new file joins one cluster in this scenario", () => {
    const before = clusterFiles(baseFiles, base);
    const shipIdBefore = [...before].find(([, m]) => m.includes("ship/c.py"))![0];

    const after = clusterFiles([...baseFiles, "billing/e.py"], [...base, { from: "billing/e.py", to: "billing/a.py", weight: 4 }]);
    const shipAfter = [...after].find(([, m]) => m.includes("ship/c.py"))!;

    expect(shipAfter[0]).toBe(shipIdBefore);
    expect([...after.values()].some((m) => [...m].sort().join() === ["billing/a.py", "billing/b.py", "billing/e.py"].join())).toBe(true);
  });

  it("can drop a previously retained edge when a new file raises maxIncidentWeight", () => {
    // The weaker claim in the plan's table, proved: retention is relative to each endpoint's
    // strongest tie, so a new strong neighbour can push an existing edge below the ratio.
    const files = ["a.py", "b.py"];
    const edges: ImportEdge[] = [{ from: "a.py", to: "b.py", weight: 3 }];
    expect(partition(clusterFiles(files, edges))).toEqual([["a.py", "b.py"]]);

    const grownEdges: ImportEdge[] = [...edges, { from: "a.py", to: "c.py", weight: 40 }];
    const grown = clusterFiles([...files, "c.py"], grownEdges);
    // 0.25 * 40 = 10 > 3, so a—b no longer survives retention and b is a singleton again.
    expect(partition(grown)).toEqual([["a.py", "c.py"], ["b.py"]]);
  });
});

describe("clusterFiles — the 4b adversarial fixture (criterion 6)", () => {
  it("reproduces the fixture's expected partition exactly, up to cluster names", () => {
    const m = manifest();
    const files = m.files.filter((f) => !m.excluded.includes(f));
    const groups = clusterFiles(files, m.edges);

    const expected = Object.values(m.expected)
      .map((f) => [...f].sort())
      .sort((a, b) => a[0]!.localeCompare(b[0]!));
    expect(partition(groups)).toEqual(expected);
  });

  it("is unaffected by the excluded files, which never reach the clustering input", () => {
    const m = manifest();
    const files = m.files.filter((f) => !m.excluded.includes(f));
    for (const f of m.excluded) expect(files).not.toContain(f);
    // Passing the excluded files' edges alongside changes nothing: their endpoints are unknown.
    expect(JSON.stringify([...clusterFiles(files, m.edges)])).toBe(JSON.stringify([...clusterFiles(files, m.edges.filter((e) => files.includes(e.from) && files.includes(e.to)))]));
  });
});

describe("assertStrictPartition", () => {
  const files = ["a.py", "b.py", "c.py"];
  const valid = (): ClusterGroups => clusterFiles(files, [{ from: "a.py", to: "b.py", weight: 4 }]);

  it("returns without mutating a valid partition", () => {
    const groups = valid();
    const before = JSON.stringify([...groups]);
    expect(() => assertStrictPartition(groups, files)).not.toThrow();
    expect(JSON.stringify([...groups])).toBe(before);
  });

  it("throws when a file lands in two groups", () => {
    const groups: ClusterGroups = new Map([
      [layerIdFor(["a.py", "b.py"]), ["a.py", "b.py"]],
      [layerIdFor(["b.py", "c.py"]), ["b.py", "c.py"]],
    ]);
    expect(() => assertStrictPartition(groups, files)).toThrow(/b\.py/);
  });

  it("throws when a file lands in no group", () => {
    const groups: ClusterGroups = new Map([[layerIdFor(["a.py", "b.py"]), ["a.py", "b.py"]]]);
    expect(() => assertStrictPartition(groups, files)).toThrow(/c\.py/);
  });

  it("throws when a member is absent from `files`", () => {
    const members = ["a.py", "b.py", "c.py", "ghost.py"];
    const groups: ClusterGroups = new Map([[layerIdFor(members), members]]);
    expect(() => assertStrictPartition(groups, files)).toThrow(/ghost\.py/);
  });

  it("throws on an empty group", () => {
    const groups: ClusterGroups = new Map([
      [layerIdFor(files), files],
      [layerIdFor([]), []],
    ]);
    expect(() => assertStrictPartition(groups, files)).toThrow(/empty/i);
  });

  it("throws when a key is not layerIdFor of its own members", () => {
    const groups: ClusterGroups = new Map([["u:layer:deadbeefdead", files]]);
    expect(() => assertStrictPartition(groups, files)).toThrow(/key/i);
  });

  it("throws rather than silently rewriting input checkAndRepairClusters would have repaired", () => {
    // Two name-shaped keys that normalize alike: checkAndRepairClusters would merge them and
    // report `repaired`. Structural ids are not names — a rewrite here would break the
    // id/membership contract everything downstream depends on, so this must throw instead.
    const groups: ClusterGroups = new Map([
      ["orders_layer", ["a.py"]],
      ["orders", ["b.py", "c.py"]],
    ]);
    expect(() => assertStrictPartition(groups, files)).toThrow(/key/i);
  });
});

describe("clustering constants", () => {
  it("names the algorithm and version it records in provenance", () => {
    expect(CLUSTERING_ALGORITHM).toBe("agglomerative-single-linkage");
    expect(CLUSTERING_VERSION).toBe("1");
  });
});

describe("resolveLayerNames — step 4", () => {
  const layer = (name: string, files: string[], why = "because"): Layer => ({
    name,
    files,
    what: "w",
    how: "h",
    when: "wh",
    where: "wr",
    why,
    confidence: 0.5,
    source: "llm",
  });

  it("normalizes a new cluster's raw name", () => {
    const resolved = resolveLayerNames([layer("Orders Layer", ["a.py"])], new Map());
    expect(resolved[0]!.name).toBe("orders");
  });

  it("suffixes new clusters colliding on a normalized name, in ascending structural-id order", () => {
    const a = layer("Orders", ["a.py"]);
    const b = layer("orders_layer", ["b.py"]);
    const byId = [a, b].sort((x, y) => layerIdFor(x.files).localeCompare(layerIdFor(y.files)));

    const resolved = resolveLayerNames([b, a], new Map());
    const nameOf = (l: Layer) => resolved.find((r) => r.files[0] === l.files[0])!.name;
    expect(nameOf(byId[0]!)).toBe("orders");
    expect(nameOf(byId[1]!)).toBe("orders-2");
  });

  it("reuses a carried-over name verbatim, without re-normalizing it", () => {
    // A predecessor's name was normalized when first assigned and is persisted in the record.
    // Re-running the normalizer on it risks changing a stored name if that function ever
    // changes — which would break stickiness for a layer whose membership never moved.
    const previous = layer("Legacy Name Layer", ["a.py"]);
    const id = layerIdFor(["a.py"]);
    const resolved = resolveLayerNames([{ ...previous, name: "Legacy Name Layer" }], new Map([[id, previous]]));
    expect(resolved[0]!.name).toBe("Legacy Name Layer");
  });

  it("makes a new cluster take the suffix, even when its id sorts before the predecessor's", () => {
    // The case naive id-order suffixing gets wrong. Precedence is by origin, not by id: a
    // predecessor must stay byte-identical, or "unchanged membership ⇒ unchanged layer" fails.
    const files = [["a.py"], ["b.py"], ["c.py"], ["d.py"]];
    const ids = files.map((f) => layerIdFor(f));
    const lowest = ids.indexOf([...ids].sort()[0]!);
    const higher = ids.indexOf([...ids].sort()[1]!);

    const predecessor = layer("orders", files[higher]!);
    const fresh = layer("Orders", files[lowest]!);
    const previous = new Map([[ids[higher]!, predecessor]]);

    const resolved = resolveLayerNames([fresh, { ...predecessor }], previous);
    const nameFor = (idx: number) => resolved.find((r) => r.files[0] === files[idx]![0])!.name;
    expect(nameFor(higher)).toBe("orders");
    expect(nameFor(lowest)).toBe("orders-2");
  });

  it("does not append a second suffix to a carried-over name that already has one", () => {
    const previous = layer("orders-2", ["a.py"]);
    const id = layerIdFor(["a.py"]);
    const resolved = resolveLayerNames([{ ...previous }], new Map([[id, previous]]));
    expect(resolved[0]!.name).toBe("orders-2");
  });

  it("keeps a new name that collides with a claimed suffixed name moving to the next free slot", () => {
    const first = layer("orders", ["a.py"]);
    const second = layer("orders", ["b.py"]);
    const third = layer("orders", ["c.py"]);
    const resolved = resolveLayerNames([first, second, third], new Map());
    expect([...resolved.map((r) => r.name)].sort()).toEqual(["orders", "orders-2", "orders-3"]);
  });

  it("returns layers in ascending structural-id order", () => {
    const layers = [layer("z", ["z.py"]), layer("a", ["a.py"]), layer("m", ["m.py"])];
    const resolved = resolveLayerNames(layers, new Map());
    const ids = resolved.map((l) => layerIdFor(l.files));
    expect(ids).toEqual([...ids].sort());
  });
});

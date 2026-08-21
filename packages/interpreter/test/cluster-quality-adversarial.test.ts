import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clusteringQuality, directoryClusters, type ImportEdge } from "../src/checker.js";

/**
 * The adversarial fixture (plan 4b) exists to be *hard* for a directory-shaped clustering: it
 * deliberately contains a conceptual module spanning directories, two unrelated modules sharing
 * one directory, generated and test code, a cycle, and a high-fan-in utility. Building it before
 * the algorithm is the point — the expectations below are what "better than the directory
 * baseline" has to mean concretely, fixed in advance so a later algorithm cannot be tuned until
 * it happens to look right.
 *
 * Everything here is asserted from the manifest, never eyeballed.
 */
const ROOT = join(__dirname, "../../../fixtures/cluster-quality-adversarial");

type Manifest = {
  files: string[];
  edges: ImportEdge[];
  /** The partition a correct clustering should find, as a name -> files map. */
  expected: Record<string, string[]>;
  /** Files that must not drive the partition: generated and test code. */
  excluded: string[];
  /** The utility every layer imports — it must not pull the repo into one cluster. */
  highFanIn: string;
  /** Two files in the same directory that belong to different clusters. */
  sameDirDifferentClusters: [string, string];
  /** One cluster whose files live in more than one directory. */
  spansDirectories: string;
  /** A pair of files that import each other. */
  cycle: [string, string];
};

function manifest(): Manifest {
  return JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8")) as Manifest;
}

describe("cluster-quality adversarial fixture", () => {
  it("declares every file it references, and references every file it declares", () => {
    const m = manifest();
    const declared = new Set(m.files);
    const inPartition = Object.values(m.expected).flat();

    for (const f of inPartition) expect(declared.has(f), `${f} is in the partition but not in files`).toBe(true);
    for (const e of m.edges) {
      expect(declared.has(e.from), `edge from ${e.from} references an undeclared file`).toBe(true);
      expect(declared.has(e.to), `edge to ${e.to} references an undeclared file`).toBe(true);
    }
    // Every non-excluded file is placed exactly once: a fixture with a file in two clusters
    // would make "the expected partition" ambiguous and the assertions below meaningless.
    const placed = inPartition.filter((f) => !m.excluded.includes(f));
    expect(new Set(placed).size).toBe(placed.length);
    const shouldBePlaced = m.files.filter((f) => !m.excluded.includes(f));
    expect([...placed].sort()).toEqual([...shouldBePlaced].sort());
  });

  it("is genuinely adversarial: the directory baseline scores worse than the intended partition", () => {
    const m = manifest();
    // This is the fixture's whole reason to exist. If a plain directory bucketing already
    // matched the intended answer, the fixture would prove nothing about a clustering algorithm.
    const baseline = clusteringQuality(directoryClusters(m.files), m.edges);
    const intended = clusteringQuality(m.expected, m.edges);
    expect(intended.modularity).toBeGreaterThan(baseline.modularity);
  });

  it("has a conceptual module spanning more than one directory", () => {
    const m = manifest();
    const dirs = new Set(m.expected[m.spansDirectories]!.map((f) => f.slice(0, f.lastIndexOf("/"))));
    expect(dirs.size).toBeGreaterThan(1);
  });

  it("has two unrelated files sharing a directory but belonging to different clusters", () => {
    const m = manifest();
    const [a, b] = m.sameDirDifferentClusters;
    expect(a.slice(0, a.lastIndexOf("/"))).toBe(b.slice(0, b.lastIndexOf("/")));
    const clusterOf = (f: string) => Object.entries(m.expected).find(([, files]) => files.includes(f))?.[0];
    expect(clusterOf(a)).not.toBe(clusterOf(b));
    expect(clusterOf(a)).toBeDefined();
  });

  it("has a cycle, so an algorithm assuming a DAG cannot pass by accident", () => {
    const m = manifest();
    const [a, b] = m.cycle;
    expect(m.edges.some((e) => e.from === a && e.to === b)).toBe(true);
    expect(m.edges.some((e) => e.from === b && e.to === a)).toBe(true);
  });

  it("has a high-fan-in utility imported from at least three different clusters", () => {
    const m = manifest();
    const clusterOf = (f: string) => Object.entries(m.expected).find(([, files]) => files.includes(f))?.[0];
    const importers = new Set(m.edges.filter((e) => e.to === m.highFanIn).map((e) => clusterOf(e.from)));
    importers.delete(clusterOf(m.highFanIn));
    expect(importers.size).toBeGreaterThanOrEqual(3);
  });

  it("contains generated and test code, excluded from the partition that drives clustering", () => {
    const m = manifest();
    expect(m.excluded.some((f) => f.includes("generated"))).toBe(true);
    expect(m.excluded.some((f) => f.startsWith("tests/"))).toBe(true);
    for (const f of m.excluded) expect(m.files).toContain(f);
  });

  it("ships every declared file on disk, so the fixture can actually be analyzed end to end", () => {
    const m = manifest();
    for (const f of m.files) {
      expect(() => readFileSync(join(ROOT, f), "utf8"), `${f} is declared but missing on disk`).not.toThrow();
    }
  });
});

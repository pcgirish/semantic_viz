import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractRepo } from "@scv/extractor";
import { afterEach, describe, expect, it } from "vitest";
import { runExport } from "../src/export.js";
import { computeClusters } from "../src/fingerprints.js";
import { runHydrate } from "../src/hydrate.js";
import { STORE_REL_DIR } from "../src/semantics-store.js";
import { toSnapshot } from "../src/snapshot.js";
import { gitFixture, mergeInto, narration, type GitFixture } from "./git-fixture.js";

const orderlyRoot = fileURLToPath(new URL("../../../fixtures/orderly", import.meta.url));
const CHAIN = "def a():\n    return b()\n\n\ndef b():\n    return c()\n\n\ndef c():\n    return 1\n";
const fn = (what: string) => ({ kind: "function" as const, semantics: narration(what) });

function artifacts(scvDir: string, sha: string): Record<string, unknown> {
  const dir = path.join(scvDir, "artifacts", sha);
  const out: Record<string, unknown> = {};
  // authored.json is the local authoring record, not a pipeline artifact.
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json") && n !== "authored.json").sort()) {
    out[name] = JSON.parse(readFileSync(path.join(dir, name), "utf-8"));
  }
  return out;
}

const functionIds = (root: string) => Object.fromEntries(extractRepo(root).units.filter((u) => u.kind === "function").map((u) => [u.name, u.id]));
const worktrees = (fx: GitFixture) => fx.git("worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree "));

describe("runHydrate", () => {
  let fx: GitFixture;
  afterEach(() => fx.cleanup());

  it("round-trips: export, commit, hydrate into a fresh .scv reproduces the merged artifacts", async () => {
    fx = gitFixture({ copyFrom: orderlyRoot });
    const graph = extractRepo(fx.root);
    const units = Object.fromEntries(graph.units.filter((u) => u.kind === "function").slice(0, 3).map((u) => [u.id, fn(u.name)]));
    const docs = { r: { path: "README.md", purpose: "p", modules: [], architecture_notes: [] } };
    await mergeInto(fx, { units, docs }, { withDocs: true });
    const snapshot = toSnapshot(graph, { root: fx.root, rev: { sha: "x", kind: "commit", ts: "", author: "", author_kind: "human" } });
    const files = computeClusters(snapshot.units, snapshot.edges).groups.values().next().value!;
    await mergeInto(fx, { layers: { l: { name: "Core", files, ...narration("core") } } }, { withClustering: true });
    const authoredSha = fx.git("rev-parse", "HEAD");

    runExport({ root: fx.root, scvDir: fx.scvDir });
    const storeSha = fx.commit("store");
    const freshScv = path.join(path.dirname(fx.scvDir), "scv-fresh");
    const result = await runHydrate({ root: fx.root, scvDir: freshScv });

    expect(result.sha).toBe(storeSha);
    expect(result).toMatchObject({ merged: 5, stale: 0 });
    const original = artifacts(fx.scvDir, authoredSha);
    const hydrated = artifacts(freshScv, storeSha);
    expect(hydrated).toEqual(original);
    expect(JSON.stringify(hydrated["layers.json"])).toContain('"Core"');
  });

  it("hydrates a historical rev against that rev's own structure", async () => {
    fx = gitFixture({ files: { "chain.py": CHAIN } });
    const ids = functionIds(fx.root);
    await mergeInto(fx, { units: { [ids.c!]: fn("c1") } });
    runExport({ root: fx.root, scvDir: fx.scvDir });
    const authored = fx.commit("store");
    fx.write("chain.py", CHAIN.replace("return 1", "return 2"));
    const edited = fx.commit("edit c");

    const atAuthored = await runHydrate({ root: fx.root, rev: authored, scvDir: path.join(path.dirname(fx.scvDir), "h1") });
    expect(atAuthored).toMatchObject({ sha: authored, merged: 1, stale: 0 });
    const atEdited = await runHydrate({ root: fx.root, rev: edited, scvDir: path.join(path.dirname(fx.scvDir), "h2") });
    expect(atEdited).toMatchObject({ sha: edited, merged: 0, stale: 1 });
    expect(worktrees(fx)).toHaveLength(1);
  });

  it("extracts in place for a clean HEAD", async () => {
    fx = gitFixture({ files: { "chain.py": CHAIN } });
    await runHydrate({ root: fx.root, scvDir: fx.scvDir });
    expect(worktrees(fx)).toHaveLength(1);
  });

  it("removes its temporary worktree when hydration fails", async () => {
    fx = gitFixture({ files: { "chain.py": CHAIN } });
    const bad = path.join(fx.root, STORE_REL_DIR);
    mkdirSync(bad, { recursive: true });
    writeFileSync(path.join(bad, "docs.json"), JSON.stringify({ storeVersion: 999, docs: {} }));
    const badSha = fx.commit("malformed store");
    fx.write("chain.py", CHAIN + "\n");
    fx.commit("later");

    await expect(runHydrate({ root: fx.root, rev: badSha, scvDir: fx.scvDir })).rejects.toThrow(/storeVersion/);
    expect(worktrees(fx)).toHaveLength(1);
  });

  it("rejects a rev that does not name a commit", async () => {
    fx = gitFixture({ files: { "chain.py": CHAIN } });
    await expect(runHydrate({ root: fx.root, rev: "no-such-rev", scvDir: fx.scvDir })).rejects.toThrow(/no-such-rev/);
    await expect(runHydrate({ root: fx.root, rev: "--output=x", scvDir: fx.scvDir })).rejects.toThrow();
  });
});

import { extractRepo } from "@scv/extractor";
import { afterEach, describe, expect, it } from "vitest";
import { runCheck, type CheckItem, type CheckResult } from "../src/check.js";
import { runExport } from "../src/export.js";
import { computeClusters } from "../src/fingerprints.js";
import { toSnapshot } from "../src/snapshot.js";
import { gitFixture, mergeInto, narration, type GitFixture } from "./git-fixture.js";

const CHAIN = "def a():\n    return b()\n\n\ndef b():\n    return c()\n\n\ndef c():\n    return 1\n";
const README = "# chain\n\nA three-function call chain.\n";
const LIB = "def c():\n    return 1\n";
const APP = "from lib import c\n\n\ndef a():\n    return b()\n\n\ndef b():\n    return c()\n";

const fn = (what: string) => ({ kind: "function" as const, semantics: narration(what) });
const doc = (purpose: string) => ({ r: { path: "README.md", purpose, modules: [], architecture_notes: [] } });
const functionIds = (root: string) => Object.fromEntries(extractRepo(root).units.filter((u) => u.kind === "function").map((u) => [u.name, u.id]));

function layerFiles(root: string): string[] {
  const graph = extractRepo(root);
  const snapshot = toSnapshot(graph, { root, rev: { sha: "x", kind: "commit", ts: "", author: "", author_kind: "human" } });
  return computeClusters(snapshot.units, snapshot.edges).groups.values().next().value!;
}

/** Authors every expected entry (each function, the README, one layer, empty groups and flows),
 *  exports and commits the store. */
async function authorAll(fx: GitFixture, layerName = "Core"): Promise<string> {
  const units = Object.fromEntries(Object.entries(functionIds(fx.root)).map(([name, id]) => [id, fn(`${name}1`)]));
  await mergeInto(fx, { units, docs: doc("p") }, { withDocs: true });
  await authorGlobals(fx, layerName);
  return fx.commit("store");
}

async function authorGlobals(fx: GitFixture, layerName: string): Promise<void> {
  await mergeInto(fx, { layers: { l: { name: layerName, files: layerFiles(fx.root), ...narration(layerName) } } }, { withClustering: true });
  await mergeInto(fx, {}, { withClustering: true, withGroups: true, withFlows: true });
  runExport({ root: fx.root, scvDir: fx.scvDir });
}

const of = (result: CheckResult, kind: CheckItem["kind"]) => result.items.filter((item) => item.kind === kind).map(({ status, id }) => `${status} ${id}`);

describe("runCheck", () => {
  let fx: GitFixture;
  afterEach(() => fx.cleanup());

  it("passes when every expected entry is committed and fresh", async () => {
    fx = gitFixture({ files: { "chain.py": CHAIN, "README.md": README } });
    await authorAll(fx);
    const result = await runCheck({ root: fx.root, scvDir: fx.scvDir });
    expect(result.items).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("reports every expected entry as missing for an empty store, each naming its fixing skill", async () => {
    fx = gitFixture({ files: { "chain.py": CHAIN, "README.md": README } });
    const ids = functionIds(fx.root);
    const result = await runCheck({ root: fx.root, scvDir: fx.scvDir });
    expect(result.ok).toBe(false);
    expect(of(result, "function").sort()).toEqual([ids.a, ids.b, ids.c].map((id) => `missing ${id}`).sort());
    expect(result.items).toContainEqual({ status: "missing", kind: "docs", id: "README.md", skill: "agent-analyze-docs" });
    expect(result.items).toContainEqual({ status: "missing", kind: "layers", id: "layers.json", skill: "agent-analyze-layers" });
    expect(result.items).toContainEqual({ status: "missing", kind: "groups", id: "groups.json", skill: "agent-analyze-groups" });
    expect(result.items).toContainEqual({ status: "missing", kind: "flows", id: "flows.json", skill: "agent-analyze-flows" });
    expect(result.items.find((item) => item.id === ids.a)).toEqual({ status: "missing", kind: "function", id: ids.a, file: "chain.py", skill: "agent-analyze-functions" });
  });

  it("does not expect entries for test code", async () => {
    fx = gitFixture({ files: { "chain.py": CHAIN, "README.md": README } });
    await authorAll(fx);
    fx.write("tests/test_chain.py", "def test_a():\n    return 1\n");
    expect(of(await runCheck({ root: fx.root, scvDir: fx.scvDir }), "function")).toEqual([]);
  });

  it("terminates on recursion and keeps a cycle fresh against itself", async () => {
    const cycle = "def even(n):\n    return n == 0 or odd(n - 1)\n\n\ndef odd(n):\n    return n != 0 and even(n - 1)\n\n\ndef fact(n):\n    return 1 if n < 2 else n * fact(n - 1)\n";
    fx = gitFixture({ files: { "cycle.py": cycle, "README.md": README } });
    await authorAll(fx);
    expect((await runCheck({ root: fx.root, scvDir: fx.scvDir })).items).toEqual([]);
  });

  it("flags a body-only edit as stale for that unit alone", async () => {
    fx = gitFixture({ files: { "chain.py": CHAIN, "README.md": README } });
    await authorAll(fx);
    const ids = functionIds(fx.root);
    fx.write("chain.py", CHAIN.replace("return 1", "return 2"));
    const result = await runCheck({ root: fx.root, scvDir: fx.scvDir });
    expect(of(result, "function")).toEqual([`stale ${ids.c}`]);
    expect(result.ok).toBe(false);
  });

  it("flags a callee whose callers changed, and the new caller as missing", async () => {
    fx = gitFixture({ files: { "chain.py": CHAIN, "README.md": README } });
    await authorAll(fx);
    const before = functionIds(fx.root);
    fx.write("chain.py", `${CHAIN}\n\ndef d():\n    return c()\n`);
    const ids = functionIds(fx.root);
    expect(ids.c).toBe(before.c);
    const result = await runCheck({ root: fx.root, scvDir: fx.scvDir });
    expect(of(result, "function").sort()).toEqual([`missing ${ids.d}`, `stale ${ids.c}`].sort());
    expect(of(result, "groups")).toEqual(["stale groups.json"]);
    expect(of(result, "flows")).toEqual(["stale flows.json"]);
  });

  it("flags a caller whose callee was re-authored", async () => {
    fx = gitFixture({ files: { "chain.py": CHAIN, "README.md": README } });
    await authorAll(fx);
    const ids = functionIds(fx.root);
    await mergeInto(fx, { units: { [ids.c!]: fn("c2") } });
    runExport({ root: fx.root, scvDir: fx.scvDir });
    expect(of(await runCheck({ root: fx.root, scvDir: fx.scvDir }), "function")).toEqual([`stale ${ids.b}`]);
  });

  it("propagates re-authoring up an a → b → c chain one caller at a time", async () => {
    fx = gitFixture({ files: { "chain.py": CHAIN, "README.md": README } });
    await authorAll(fx);
    const ids = functionIds(fx.root);
    fx.write("chain.py", CHAIN.replace("return 1", "return 2"));
    fx.commit("edit c");
    const reauthor = async (id: string, what: string) => {
      await mergeInto(fx, { units: { [id]: fn(what) } });
      runExport({ root: fx.root, scvDir: fx.scvDir });
      return of(await runCheck({ root: fx.root, scvDir: fx.scvDir }), "function");
    };
    expect(await reauthor(ids.c!, "c2")).toEqual([`stale ${ids.b}`]);
    expect(await reauthor(ids.b!, "b2")).toEqual([`stale ${ids.a}`]);
    expect(await reauthor(ids.a!, "a2")).toEqual([]);
  });

  it("reports entries whose unit or document no longer exists as orphaned", async () => {
    fx = gitFixture({ files: { "chain.py": CHAIN, "README.md": README } });
    await authorAll(fx);
    const ids = functionIds(fx.root);
    fx.write("chain.py", "def a():\n    return 1\n");
    fx.git("rm", "-q", "README.md");
    const result = await runCheck({ root: fx.root, scvDir: fx.scvDir });
    expect(of(result, "function")).toEqual(expect.arrayContaining([`orphaned ${ids.b}`, `orphaned ${ids.c}`]));
    expect(of(result, "docs")).toEqual(["orphaned README.md"]);
  });

  it("flags a doc edit, then the layers written against the old doc once it is re-authored", async () => {
    fx = gitFixture({ files: { "chain.py": CHAIN, "README.md": README } });
    await authorAll(fx);
    fx.write("README.md", `${README}\nMore.\n`);
    let result = await runCheck({ root: fx.root, scvDir: fx.scvDir });
    expect(of(result, "docs")).toEqual(["stale README.md"]);
    expect(of(result, "layers")).toEqual([]);

    fx.commit("edit readme");
    await mergeInto(fx, { docs: doc("p2") }, { withDocs: true });
    runExport({ root: fx.root, scvDir: fx.scvDir });
    result = await runCheck({ root: fx.root, scvDir: fx.scvDir });
    expect(of(result, "docs")).toEqual([]);
    expect(of(result, "layers")).toEqual(["stale layers.json"]);
  });

  it("flags groups written against layers that were since re-authored", async () => {
    fx = gitFixture({ files: { "chain.py": CHAIN, "README.md": README } });
    await authorAll(fx);
    await mergeInto(fx, { layers: { l: { name: "Renamed", files: layerFiles(fx.root), ...narration("renamed") } } }, { withClustering: true });
    runExport({ root: fx.root, scvDir: fx.scvDir });
    const result = await runCheck({ root: fx.root, scvDir: fx.scvDir });
    expect(of(result, "layers")).toEqual([]);
    expect(of(result, "groups")).toEqual(["stale groups.json"]);
  });

  describe("with --base", () => {
    it("reports only units whose inputs changed since the merge base, including callers outside the diff", async () => {
      fx = gitFixture({ files: { "lib.py": LIB, "app.py": APP, "README.md": README } });
      await authorAll(fx);
      const ids = functionIds(fx.root);
      fx.git("branch", "base");

      // On the PR branch: c's body changes and c is re-authored, so b (in app.py, untouched) is stale.
      fx.write("lib.py", LIB.replace("return 1", "return 2"));
      fx.commit("edit c");
      await mergeInto(fx, { units: { [ids.c!]: fn("c2") } });
      runExport({ root: fx.root, scvDir: fx.scvDir });
      fx.commit("store");

      const result = await runCheck({ root: fx.root, scvDir: fx.scvDir, base: "base" });
      expect(of(result, "function")).toEqual([`stale ${ids.b}`]);
      expect(result.base).toMatchObject({ ref: "base", sha: fx.git("rev-parse", "base") });
    });

    it("leaves out staleness that predates the merge base but still checks global artifacts", async () => {
      fx = gitFixture({ files: { "lib.py": LIB, "app.py": APP, "README.md": README } });
      await authorAll(fx);
      const ids = functionIds(fx.root);
      // Committed on the base branch without re-authoring: c (and flows) are stale before the PR.
      fx.write("lib.py", LIB.replace("return 1", "return 2"));
      fx.commit("unreviewed edit");
      fx.git("branch", "base");
      fx.write("app.py", `${APP}\n\ndef d():\n    return 1\n`);
      fx.commit("add d");
      const d = functionIds(fx.root).d!;

      const result = await runCheck({ root: fx.root, scvDir: fx.scvDir, base: "base" });
      expect(of(result, "function")).toEqual([`missing ${d}`]);
      expect(of(result, "function")).not.toContain(`stale ${ids.c}`);
      expect(of(result, "flows")).toEqual(["stale flows.json"]);

      expect(of(await runCheck({ root: fx.root, scvDir: fx.scvDir }), "function")).toEqual(expect.arrayContaining([`stale ${ids.c}`, `missing ${d}`]));
    });

    it("reports an orphan created by the diff but not one that predates it", async () => {
      fx = gitFixture({ files: { "lib.py": LIB, "app.py": APP, "README.md": README } });
      await authorAll(fx);
      const ids = functionIds(fx.root);
      fx.write("lib.py", "");
      fx.commit("drop c on base");
      fx.git("branch", "base");
      fx.write("app.py", "def a():\n    return 1\n");
      fx.commit("drop b");

      const functions = of(await runCheck({ root: fx.root, scvDir: fx.scvDir, base: "base" }), "function");
      expect(functions).toContain(`orphaned ${ids.b}`);
      expect(functions).not.toContain(`orphaned ${ids.c}`);
    });

    it("rejects a base ref that does not resolve", async () => {
      fx = gitFixture({ files: { "chain.py": CHAIN } });
      await expect(runCheck({ root: fx.root, scvDir: fx.scvDir, base: "no-such-branch" })).rejects.toThrow(/no-such-branch/);
      await expect(runCheck({ root: fx.root, scvDir: fx.scvDir, base: "--all" })).rejects.toThrow();
    });
  });
});

import path from "node:path";
import { extractRepo } from "@scv/extractor";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runExport } from "../src/export.js";
import { STORE_REL_DIR, readStoreFromDisk } from "../src/semantics-store.js";
import { gitFixture, mergeInto, narration, type GitFixture } from "./git-fixture.js";

const CHAIN = "def a():\n    return b()\n\n\ndef b():\n    return c()\n\n\ndef c():\n    return 1\n";
const EDITED_CHAIN = CHAIN.replace("return 1", "return 2");

function unitIds(root: string): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const unit of extractRepo(root).units) if (unit.kind === "function") ids[unit.name] = unit.id;
  return ids;
}

const fn = (what: string) => ({ kind: "function" as const, semantics: narration(what) });

describe("runExport", () => {
  let fx: GitFixture;
  let ids: Record<string, string>;
  const store = () => readStoreFromDisk(path.join(fx.root, STORE_REL_DIR));
  const exported = (id: string) => store().functions["chain.py"]?.[id];

  beforeEach(() => {
    fx = gitFixture({ files: { "chain.py": CHAIN, "README.md": "# chain\n\nA three-function call chain.\n" } });
    ids = unitIds(fx.root);
  });
  afterEach(() => fx.cleanup());

  it("writes fresh authored entries, sharded by source file, with their merge-time stamps", async () => {
    await mergeInto(fx, { units: { [ids.a!]: fn("a1"), [ids.c!]: fn("c1") } });
    const result = runExport({ root: fx.root, scvDir: fx.scvDir });

    expect(Object.keys(store().functions)).toEqual(["chain.py"]);
    expect(Object.keys(store().functions["chain.py"]!).sort()).toEqual([ids.a, ids.c].sort());
    expect(exported(ids.c!)!.semantics!.what).toBe("c1");
    expect(exported(ids.c!)!.fingerprint).toMatch(/^[0-9a-f]{40}$/);
    expect(result.functions).toBe(2);
  });

  it("keeps every other entry when one unit is re-authored", async () => {
    await mergeInto(fx, { units: { [ids.a!]: fn("a1"), [ids.b!]: fn("b1"), [ids.c!]: fn("c1") } });
    runExport({ root: fx.root, scvDir: fx.scvDir });
    const before = store();

    await mergeInto(fx, { units: { [ids.a!]: fn("a2") } });
    runExport({ root: fx.root, scvDir: fx.scvDir });
    const after = store();

    expect(after.functions["chain.py"]![ids.a!]!.semantics!.what).toBe("a2");
    expect(after.functions["chain.py"]![ids.b!]).toEqual(before.functions["chain.py"]![ids.b!]);
    expect(after.functions["chain.py"]![ids.c!]).toEqual(before.functions["chain.py"]![ids.c!]);
  });

  it("never writes a caller made stale by its callee chain until it is re-authored", async () => {
    await mergeInto(fx, { units: { [ids.a!]: fn("a1"), [ids.b!]: fn("b1"), [ids.c!]: fn("c1") } });
    runExport({ root: fx.root, scvDir: fx.scvDir });
    fx.commit("store");
    const original = exported(ids.a!)!;

    // C's body changes and C is re-authored: B is stale, A still reads B's unchanged semantics.
    fx.write("chain.py", EDITED_CHAIN);
    fx.commit("edit c");
    await mergeInto(fx, { units: { [ids.c!]: fn("c2") } });
    let result = runExport({ root: fx.root, scvDir: fx.scvDir });
    expect(exported(ids.c!)!.semantics!.what).toBe("c2");
    expect(exported(ids.b!)!.semantics!.what).toBe("b1");
    expect(result.stale).toBe(1);

    // Re-authoring B changes what A was written against: A is now stale and is left as it was.
    await mergeInto(fx, { units: { [ids.b!]: fn("b2") } });
    result = runExport({ root: fx.root, scvDir: fx.scvDir });
    expect(exported(ids.b!)!.semantics!.what).toBe("b2");
    expect(exported(ids.a!)).toEqual(original);
    expect(result.stale).toBe(1);

    await mergeInto(fx, { units: { [ids.a!]: fn("a2") } });
    result = runExport({ root: fx.root, scvDir: fx.scvDir });
    expect(exported(ids.a!)!.semantics!.what).toBe("a2");
    expect(exported(ids.a!)!.fingerprint).not.toBe(original.fingerprint);
    expect(result.stale).toBe(0);
  });

  it("prunes entries whose unit or doc no longer exists", async () => {
    await mergeInto(fx, { units: { [ids.c!]: fn("c1") }, docs: { r: { path: "README.md", purpose: "p", modules: [], architecture_notes: [] } } }, { withDocs: true });
    runExport({ root: fx.root, scvDir: fx.scvDir });
    expect(store().docs["README.md"]).toBeDefined();

    fx.git("rm", "-q", "README.md");
    fx.write("chain.py", "def a():\n    return 1\n");
    fx.commit("drop c and readme");
    runExport({ root: fx.root, scvDir: fx.scvDir });
    expect(store().functions).toEqual({});
    expect(store().docs).toEqual({});
  });

  it("refuses a store that resolves outside the repo", async () => {
    const { symlinkSync, mkdirSync } = await import("node:fs");
    const outside = path.join(path.dirname(fx.root), "outside");
    mkdirSync(outside);
    symlinkSync(outside, path.join(fx.root, ".scv"));
    expect(() => runExport({ root: fx.root, scvDir: fx.scvDir })).toThrow(/outside/);
  });
});

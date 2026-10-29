import { existsSync, mkdtempSync, readdirSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyStore, readStoreFromDisk, writeStore, type StoreContents } from "../src/semantics-store.js";

// Pass-through mock so a single rename can be made to fail at a chosen point of the swap.
const realRename = vi.hoisted(() => ({ fn: undefined as unknown as typeof import("node:fs").renameSync }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  realRename.fn = actual.renameSync;
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

const FP = "a".repeat(40);
const semantics = { what: "w", how: "h", when: "n", where: "r", why: "y", confidence: 0.5 };

function storeSaying(what: string): StoreContents {
  const store = emptyStore();
  store.functions["src/a.py"] = { "u:src.a.f": { kind: "function", fingerprint: FP, semantics: { ...semantics, what } } };
  return store;
}

describe("store swap recovery", () => {
  let scvDir: string;
  let semanticsDir: string;
  let oldDir: string;
  const what = () => readStoreFromDisk(semanticsDir).functions["src/a.py"]?.["u:src.a.f"]?.semantics?.what;

  beforeEach(() => {
    scvDir = mkdtempSync(path.join(tmpdir(), "scv-swap-"));
    semanticsDir = path.join(scvDir, "semantics");
    oldDir = path.join(scvDir, ".semantics-old");
  });
  afterEach(() => {
    vi.mocked(renameSync).mockReset().mockImplementation(realRename.fn);
    rmSync(scvDir, { recursive: true, force: true });
  });

  it("restores the old store when interrupted after it was moved aside", () => {
    writeStore(semanticsDir, storeSaying("old"));
    renameSync(semanticsDir, oldDir);

    expect(what()).toBe("old");
    expect(readdirSync(scvDir)).toEqual(["semantics"]);
  });

  it("discards the moved-aside store when interrupted after the new one was swapped in", () => {
    writeStore(semanticsDir, storeSaying("new"));
    writeStore(path.join(scvDir, "other"), storeSaying("old"));
    renameSync(path.join(scvDir, "other"), oldDir);
    expect(what()).toBe("new");
    expect(readdirSync(scvDir)).toEqual(["semantics"]);
  });

  it("refuses to restore a moved-aside store that is a symlink", () => {
    const outside = mkdtempSync(path.join(tmpdir(), "scv-swap-outside-"));
    try {
      writeStore(path.join(outside, "semantics"), storeSaying("planted"));
      symlinkSync(path.join(outside, "semantics"), oldDir);

      expect(() => readStoreFromDisk(semanticsDir)).toThrow(/symlink/);
      expect(() => writeStore(semanticsDir, storeSaying("new"))).toThrow(/symlink/);
      expect(existsSync(semanticsDir)).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("puts the old store back when swapping in the new one fails", () => {
    writeStore(semanticsDir, storeSaying("old"));
    // First rename moves the old store aside; the second, swapping the new one in, fails.
    vi.mocked(renameSync)
      .mockImplementationOnce(realRename.fn)
      .mockImplementationOnce(() => {
        throw new Error("rename failed");
      });

    expect(() => writeStore(semanticsDir, storeSaying("new"))).toThrow(/rename failed/);
    expect(what()).toBe("old");
    expect(readdirSync(scvDir)).toEqual(["semantics"]);
  });
});

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  STORE_VERSION,
  decodeShardName,
  emptyStore,
  encodeShardName,
  readStoreFromDisk,
  readStoreFromGit,
  storeDirIn,
  writeStore,
  type StoreContents,
} from "../src/semantics-store.js";

const FP = "a".repeat(40);
const semantics = { what: "w", how: "h", when: "n", where: "r", why: "y", confidence: 0.5 };

function sampleStore(): StoreContents {
  const store = emptyStore();
  store.functions["src/a.py"] = { "u:src.a.f": { kind: "function", fingerprint: FP, semantics } };
  store.docs["README.md"] = { path: "README.md", fingerprint: FP, purpose: "p", modules: [], architecture_notes: [] };
  store.layers = { fingerprint: FP, layers: { "layer:x": { name: "Core", files: ["src/a.py"], ...semantics } } };
  return store;
}

describe("shard name encoding", () => {
  it.each(["src/a.py", "src/Upper/Case.ts", "a b/ü.py", "..%2F/x.py", "dir/.hidden.py"])("round-trips %s", (file) => {
    expect(decodeShardName(encodeShardName(file))).toBe(file);
  });

  it("produces a single, contained, case-insensitive-safe path component", () => {
    for (const file of ["a/b/c.py", "..x/y.py", "src/A.py", "src/a.py"]) {
      const name = encodeShardName(file);
      expect(name).not.toContain("/");
      expect(name).not.toContain("\\");
      expect(name).toMatch(/^(?:[a-z0-9._-]|%[0-9A-F]{2})+\.json$/);
      expect(name).not.toBe("..json");
    }
    expect(encodeShardName("src/A.py").toLowerCase()).not.toBe(encodeShardName("src/a.py").toLowerCase());
  });

  it("rejects source paths that are absolute, escape the repo, or are empty", () => {
    for (const bad of ["/etc/passwd", "../x.py", "src/../../x.py", "", "a\0b"]) {
      expect(() => encodeShardName(bad)).toThrow();
    }
  });

  it("rejects non-canonical shard names on decode", () => {
    for (const bad of ["src%2fa.py.json", "SRC.json", "x.txt", "%ZZ.json", "src%2F..%2Fx.json"]) {
      expect(() => decodeShardName(bad)).toThrow();
    }
  });
});

describe("store on disk", () => {
  let scvDir: string;
  let semanticsDir: string;

  beforeEach(() => {
    scvDir = mkdtempSync(path.join(tmpdir(), "scv-store-"));
    semanticsDir = path.join(scvDir, "semantics");
  });
  afterEach(() => rmSync(scvDir, { recursive: true, force: true }));

  it("round-trips through write and read", () => {
    const store = sampleStore();
    writeStore(semanticsDir, store);
    expect(readStoreFromDisk(semanticsDir)).toEqual(store);
    expect(existsSync(path.join(semanticsDir, "functions", encodeShardName("src/a.py")))).toBe(true);
    expect(existsSync(path.join(semanticsDir, "groups.json"))).toBe(false);
  });

  it("reads a missing store as empty", () => {
    expect(readStoreFromDisk(semanticsDir)).toEqual(emptyStore());
  });

  it("leaves files and mtimes untouched when nothing changed", () => {
    writeStore(semanticsDir, sampleStore());
    const file = path.join(semanticsDir, "docs.json");
    const before = statSync(file).mtimeMs;
    writeStore(semanticsDir, sampleStore());
    expect(statSync(file).mtimeMs).toBe(before);
  });

  it("replaces the whole store atomically, removing shards no longer present", () => {
    writeStore(semanticsDir, sampleStore());
    const next = sampleStore();
    delete next.functions["src/a.py"];
    next.functions["src/b.py"] = { "u:src.b.g": { kind: "function", fingerprint: FP, semantics } };
    writeStore(semanticsDir, next);
    expect(readdirSync(path.join(semanticsDir, "functions"))).toEqual([encodeShardName("src/b.py")]);
    expect(readdirSync(scvDir).sort()).toEqual(["semantics"]);
  });

  it("rejects an unsupported storeVersion", () => {
    writeStore(semanticsDir, sampleStore());
    const file = path.join(semanticsDir, "docs.json");
    const raw = JSON.parse(readFileSync(file, "utf-8"));
    writeFileSync(file, JSON.stringify({ ...raw, storeVersion: STORE_VERSION + 1 }));
    expect(() => readStoreFromDisk(semanticsDir)).toThrow(/storeVersion/);
  });

  it("rejects malformed files", () => {
    writeStore(semanticsDir, sampleStore());
    writeFileSync(path.join(semanticsDir, "layers.json"), "{not json");
    expect(() => readStoreFromDisk(semanticsDir)).toThrow(/layers\.json/);

    writeStore(semanticsDir, sampleStore());
    const shard = path.join(semanticsDir, "functions", encodeShardName("src/a.py"));
    writeFileSync(shard, JSON.stringify({ storeVersion: STORE_VERSION, file: "src/a.py", units: { "u:x": { kind: "module", fingerprint: FP } } }));
    expect(() => readStoreFromDisk(semanticsDir)).toThrow();
  });

  it("rejects a shard whose recorded file disagrees with its name", () => {
    writeStore(semanticsDir, sampleStore());
    const shard = path.join(semanticsDir, "functions", encodeShardName("src/a.py"));
    const raw = JSON.parse(readFileSync(shard, "utf-8"));
    writeFileSync(shard, JSON.stringify({ ...raw, file: "src/other.py" }));
    expect(() => readStoreFromDisk(semanticsDir)).toThrow(/src\/other\.py/);
  });

  it("refuses to read a store file that symlinks outside the store", () => {
    writeStore(semanticsDir, sampleStore());
    const outside = path.join(scvDir, "outside.json");
    writeFileSync(outside, readFileSync(path.join(semanticsDir, "docs.json")));
    rmSync(path.join(semanticsDir, "docs.json"));
    symlinkSync(outside, path.join(semanticsDir, "docs.json"));
    expect(() => readStoreFromDisk(semanticsDir)).toThrow(/outside/);
  });

  it("refuses to write when the functions directory symlinks outside the store", () => {
    mkdirSync(semanticsDir, { recursive: true });
    const outside = mkdtempSync(path.join(tmpdir(), "scv-store-outside-"));
    try {
      symlinkSync(outside, path.join(semanticsDir, "functions"));
      expect(() => readStoreFromDisk(semanticsDir)).toThrow(/outside/);
      expect(() => writeStore(semanticsDir, sampleStore())).toThrow(/outside/);
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("store at a git revision", () => {
  let repo: string;
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf-8", stdio: "pipe" });

  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), "scv-store-git-"));
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("reads the store committed at a revision, not the worktree's", () => {
    const semanticsDir = path.join(repo, ".scv", "semantics");
    writeStore(semanticsDir, sampleStore());
    git("add", "-A");
    git("commit", "-q", "-m", "store");
    const sha = git("rev-parse", "HEAD").trim();
    writeStore(semanticsDir, emptyStore());

    expect(readStoreFromGit(repo, sha)).toEqual(sampleStore());
  });

  it("reads a revision with no store as empty", () => {
    writeFileSync(path.join(repo, "x.txt"), "x");
    git("add", "-A");
    git("commit", "-q", "-m", "init");
    expect(readStoreFromGit(repo, git("rev-parse", "HEAD").trim())).toEqual(emptyStore());
  });

  it("rejects a committed symlink in the store", () => {
    const semanticsDir = path.join(repo, ".scv", "semantics");
    mkdirSync(semanticsDir, { recursive: true });
    symlinkSync("/etc/hosts", path.join(semanticsDir, "docs.json"));
    git("add", "-A");
    git("commit", "-q", "-m", "link");
    expect(() => readStoreFromGit(repo, git("rev-parse", "HEAD").trim())).toThrow(/docs\.json/);
  });
});

describe("store location", () => {
  let root: string;
  let outside: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "scv-store-root-"));
    outside = mkdtempSync(path.join(tmpdir(), "scv-store-outside-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("resolves a not-yet-created store under the repo root", () => {
    expect(storeDirIn(root)).toBe(path.join(root, ".scv", "semantics"));
  });

  it("refuses a store whose nearest existing ancestor is a symlink out of the repo", () => {
    symlinkSync(outside, path.join(root, ".scv"));
    expect(() => storeDirIn(root)).toThrow(/outside/);
  });

  it("refuses a dangling link on the way to the store", () => {
    symlinkSync(path.join(outside, "missing"), path.join(root, ".scv"));
    expect(() => storeDirIn(root)).toThrow(/dangling/);
  });

  it("refuses a store directory that is itself a symlink out of the repo", () => {
    mkdirSync(path.join(root, ".scv"));
    symlinkSync(outside, path.join(root, ".scv", "semantics"));
    expect(() => storeDirIn(root)).toThrow(/outside/);
  });
});

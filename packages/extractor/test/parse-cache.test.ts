import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseRepoFiles } from "../src/host.js";
import * as registry from "../src/grammars/registry.js";

function makeRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), "scv-parse-cache-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src", "a.py"), "def a():\n    return 1\n");
  writeFileSync(path.join(root, "src", "b.py"), "def b():\n    return 2\n");
  return root;
}

describe("parseRepoFiles with a cache dir", () => {
  it("reuses cached FileFacts for unchanged files and only reparses changed ones", () => {
    const root = makeRepo();
    const cacheDir = path.join(root, ".scv", "artifacts", "extraction-files");

    const first = parseRepoFiles(root, cacheDir);
    expect(first.map((f) => f.file).sort()).toEqual(["src/a.py", "src/b.py"]);

    const spy = vi.spyOn(registry, "parserFor");
    writeFileSync(path.join(root, "src", "b.py"), "def b():\n    return 3\n");

    const second = parseRepoFiles(root, cacheDir);
    expect(second.map((f) => f.file).sort()).toEqual(["src/a.py", "src/b.py"]);

    // Only b.py changed, so only b.py should have been re-parsed.
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("produces identical facts to the uncached path", () => {
    const root = makeRepo();
    const cacheDir = path.join(root, ".scv", "artifacts", "extraction-files");

    const uncached = parseRepoFiles(root);
    const cached = parseRepoFiles(root, cacheDir);

    expect(cached).toEqual(uncached);
  });
});

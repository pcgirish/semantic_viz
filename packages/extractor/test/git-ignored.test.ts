import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseRepoFiles } from "../src/host.js";
import { parseManifests } from "../src/manifest.js";
import { gitIgnoredPaths } from "../src/git-ignored.js";

/**
 * A repo whose worktree holds files git ignores — a nested fixture checkout, a vendored dir.
 * They exist locally but never in a fresh CI clone, so analyzing them makes the committed
 * store disagree between the two.
 */
function makeRepo(withGit: boolean): string {
  const root = mkdtempSync(path.join(tmpdir(), "scv-gitignored-"));
  const write = (rel: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  };
  write("src/kept.py", "def kept():\n    return 1\n");
  write("vendor/lib.py", "def vendored():\n    return 2\n");
  write("vendor/requirements.txt", "vendored-pkg==1.0.0\n");
  write("src/scratch.py", "def scratch():\n    return 3\n");
  write(".gitignore", "vendor/\nscratch.py\n");
  if (withGit) spawnSync("git", ["init", "-q"], { cwd: root });
  return root;
}

describe("git-ignored files", () => {
  const roots: string[] = [];
  const repo = (withGit: boolean) => {
    const root = makeRepo(withGit);
    roots.push(root);
    return root;
  };
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("are not parsed: only files a clone of the repo would also have", () => {
    const files = parseRepoFiles(repo(true)).map((f) => f.file);
    expect(files).toEqual(["src/kept.py"]);
  });

  it("are not read as manifests", () => {
    expect(parseManifests(repo(true)).pypi).toBeNull();
  });

  it("are all kept outside a git repo, where there are no ignore rules to apply", () => {
    const files = parseRepoFiles(repo(false)).map((f) => f.file);
    expect(files).toEqual(["src/kept.py", "src/scratch.py", "vendor/lib.py"]);
  });

  it("are reported relative to the root, and nothing is reported outside a git repo", () => {
    const candidates = ["src/kept.py", "src/scratch.py", "vendor/lib.py"];
    expect([...gitIgnoredPaths(repo(true), candidates)].sort()).toEqual(["src/scratch.py", "vendor/lib.py"]);
    expect(gitIgnoredPaths(repo(false), candidates).size).toBe(0);
    expect(gitIgnoredPaths(repo(true), []).size).toBe(0);
  });
});

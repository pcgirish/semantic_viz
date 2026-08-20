import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseRepoFiles } from "../src/host.js";
import { parseManifests } from "../src/manifest.js";

/**
 * Builds a repo whose contents are entirely inside `root`, plus a sibling `outside/`
 * directory the repo links to. The walkers must never reach `outside/`: its source would
 * otherwise be sent to the provider verbatim on an `anthropic` run.
 */
function makeRepoWithEscapingLinks(): { root: string; outside: string } {
  const base = mkdtempSync(path.join(tmpdir(), "scv-symlink-"));
  const root = path.join(base, "repo");
  const outside = path.join(base, "outside");

  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src", "inside.py"), "def inside():\n    return 1\n");

  mkdirSync(path.join(outside, "secrets"), { recursive: true });
  writeFileSync(path.join(outside, "secrets", "leak.py"), "def leak():\n    return 'secret'\n");
  writeFileSync(path.join(outside, "secrets", "requirements.txt"), "leaked-pkg==9.9.9\n");

  // A link to a file outside the repo, and a link to a whole directory outside the repo.
  symlinkSync(path.join(outside, "secrets", "leak.py"), path.join(root, "src", "linked-leak.py"));
  symlinkSync(path.join(outside, "secrets"), path.join(root, "linked-secrets"));

  return { root, outside };
}

describe("parseRepoFiles symlink containment", () => {
  it("excludes files reached through a symlink pointing outside the repo root", () => {
    const { root } = makeRepoWithEscapingLinks();

    const files = parseRepoFiles(root).map((f) => f.file);

    expect(files).toContain("src/inside.py");
    expect(files).not.toContain("src/linked-leak.py");
  });

  it("does not descend into a symlinked directory pointing outside the repo root", () => {
    const { root } = makeRepoWithEscapingLinks();

    const files = parseRepoFiles(root).map((f) => f.file);

    expect(files.filter((f) => f.startsWith("linked-secrets"))).toEqual([]);
  });
});

describe("parseRepoFiles symlink cycles", () => {
  it("terminates on a symlink pointing at its own ancestor instead of looping until ELOOP", () => {
    const root = mkdtempSync(path.join(tmpdir(), "scv-symlink-loop-"));
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "src", "a.py"), "def a():\n    return 1\n");
    // Contained, so containment alone will not stop the walker following it.
    symlinkSync("..", path.join(root, "src", "loop"));

    expect(parseRepoFiles(root).map((f) => f.file)).toEqual(["src/a.py"]);
  });
});

describe("parseManifests symlink containment", () => {
  it("does not read a manifest reached through a symlinked directory outside the repo root", () => {
    const { root } = makeRepoWithEscapingLinks();
    writeFileSync(path.join(root, "requirements.txt"), "real-pkg==1.0.0\n");

    const manifest = parseManifests(root);

    expect(manifest.pypi?.pinned.get("real-pkg")).toBe("1.0.0");
    expect(manifest.pypi?.pinned.has("leaked-pkg")).toBe(false);
  });
});

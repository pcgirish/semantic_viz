import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureFixture } from "../ensure-fixtures.mjs";

/** A one-commit repo bundled the way fixtures/orderly.bundle is: its main branch only. */
function makeBundle(dir) {
  const src = path.join(dir, "src-repo");
  const git = (...args) => spawnSync("git", args, { cwd: src, encoding: "utf-8" });
  spawnSync("git", ["init", "-q", "-b", "main", src]);
  writeFileSync(path.join(src, "app.py"), "def app():\n    return 1\n");
  git("add", ".");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-q", "-m", "baseline");
  const bundle = path.join(dir, "fixture.bundle");
  git("bundle", "create", bundle, "main");
  return { bundle, sha: git("rev-parse", "main").stdout.trim() };
}

describe("ensureFixture", () => {
  const dirs = [];
  const tempDir = () => {
    const dir = mkdtempSync(path.join(tmpdir(), "scv-ensure-fixture-"));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("clones the bundle into a missing fixture, checked out at the bundled main", () => {
    const dir = tempDir();
    const { bundle, sha } = makeBundle(dir);
    const dest = path.join(dir, "fixture");
    expect(ensureFixture(bundle, dest)).toBe("cloned");
    const head = spawnSync("git", ["-C", dest, "rev-parse", "HEAD"], { encoding: "utf-8" }).stdout.trim();
    expect(head).toBe(sha);
    expect(existsSync(path.join(dest, "app.py"))).toBe(true);
  });

  it("leaves an existing fixture checkout alone", () => {
    const dir = tempDir();
    const { bundle } = makeBundle(dir);
    const dest = path.join(dir, "fixture");
    ensureFixture(bundle, dest);
    writeFileSync(path.join(dest, "local-edit.py"), "x = 1\n");
    expect(ensureFixture(bundle, dest)).toBe("present");
    expect(existsSync(path.join(dest, "local-edit.py"))).toBe(true);
  });

  it("fails loudly when the bundle cannot be cloned", () => {
    const dir = tempDir();
    expect(() => ensureFixture(path.join(dir, "missing.bundle"), path.join(dir, "fixture"))).toThrow(/git clone .* failed/);
  });
});

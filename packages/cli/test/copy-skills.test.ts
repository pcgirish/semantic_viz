import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../scripts/copy-skills.mjs", import.meta.url));

describe("copy-skills", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "scv-copy-skills-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const skill = (root: string, name: string, body: string) => {
    mkdirSync(path.join(root, name), { recursive: true });
    writeFileSync(path.join(root, name, "SKILL.md"), body);
  };
  const copy = (src: string, dest: string) => spawnSync("node", [script, src, dest], { encoding: "utf-8" });

  it("copies only the agent-analyze-* skills, replacing what was there", () => {
    const src = path.join(dir, "src");
    const dest = path.join(dir, "dest");
    skill(src, "agent-analyze-repo", "repo");
    skill(src, "project-review", "private");
    skill(dest, "agent-analyze-gone", "stale");

    const result = copy(src, dest);

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(path.join(dest, "agent-analyze-repo", "SKILL.md"), "utf-8")).toBe("repo");
    expect(existsSync(path.join(dest, "project-review"))).toBe(false);
    expect(existsSync(path.join(dest, "agent-analyze-gone"))).toBe(false);
  });

  it("copies a symlinked skills directory as real files", () => {
    const real = path.join(dir, "real");
    skill(real, "agent-analyze-pr", "pr");
    const linked = path.join(dir, "linked");
    symlinkSync(real, linked);
    const dest = path.join(dir, "dest");

    expect(copy(linked, dest).status).toBe(0);
    expect(readFileSync(path.join(dest, "agent-analyze-pr", "SKILL.md"), "utf-8")).toBe("pr");
  });

  it("fails when the source has no agent-analyze skills", () => {
    mkdirSync(path.join(dir, "empty"));
    const result = copy(path.join(dir, "empty"), path.join(dir, "dest"));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("no agent-analyze-* skills");
  });
});

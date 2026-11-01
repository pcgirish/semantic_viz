import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { gitFixture } from "./git-fixture.js";

const binPath = fileURLToPath(new URL("../src/bin.ts", import.meta.url));

describe("bin", () => {
  it("exits non-zero with a clean error message, not a raw stack trace, when a command rejects", () => {
    const result = spawnSync(
      "npx",
      ["tsx", binPath, "analyze", "/nonexistent/repo/path/for/scv/test"],
      { encoding: "utf-8" },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("error:");
    expect(result.stderr).not.toContain("at async");
  });

  it("leaves serving to scv-viewer: no serve or ui command", () => {
    for (const command of ["serve", "ui"]) {
      const result = spawnSync("npx", ["tsx", binPath, command], { encoding: "utf-8" });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`unknown command '${command}'`);
    }
  });

  it("runs init against a repo and prints each file's outcome and the bootstrap step", () => {
    const fx = gitFixture({ files: { "m.py": "def a():\n    return 1\n" } });
    try {
      const result = spawnSync("npx", ["tsx", binPath, "init", "--install", "npm"], { encoding: "utf-8", cwd: fx.root });
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/^created\t\.github\/workflows\/scv-check\.yml$/m);
      expect(result.stdout).toContain("agent-analyze-repo");
      const bad = spawnSync("npx", ["tsx", binPath, "init", "--install", "pip"], { encoding: "utf-8", cwd: fx.root });
      expect(bad.status).not.toBe(0);
      expect(bad.stderr).toContain("error:");
    } finally {
      fx.cleanup();
    }
  });

  it("runs export then hydrate against a repo, and rejects an unknown rev cleanly", () => {
    const fx = gitFixture({ files: { "m.py": "def a():\n    return 1\n" } });
    try {
      const run = (...args: string[]) => spawnSync("npx", ["tsx", binPath, ...args], { encoding: "utf-8", cwd: fx.root });

      expect(run("export").stdout).toContain("exported 0 function/class and 0 doc entries");
      const hydrated = run("hydrate");
      expect(hydrated.status).toBe(0);
      expect(hydrated.stdout).toContain("hydrated ");
      const bad = run("hydrate", "no-such-rev");
      expect(bad.status).not.toBe(0);
      expect(bad.stderr).toContain("error:");
    } finally {
      fx.cleanup();
    }
  });

  it("runs check: findings exit non-zero as tab-separated lines or JSON, a clean store exits zero, a bad base errors", () => {
    const fx = gitFixture({ files: { "m.py": "def a():\n    return 1\n" } });
    try {
      const run = (...args: string[]) => spawnSync("npx", ["tsx", binPath, ...args], { encoding: "utf-8", cwd: fx.root });

      const text = run("check");
      expect(text.status).toBe(1);
      expect(text.stdout).toMatch(/^missing\tfunction\tu:\S+\tagent-analyze-functions$/m);
      const json = run("check", "--json");
      expect(json.status).toBe(1);
      expect(JSON.parse(json.stdout)).toMatchObject({ ok: false, items: expect.arrayContaining([expect.objectContaining({ status: "missing", kind: "function" })]) });

      const bad = run("check", "--base", "no-such-branch");
      expect(bad.status).not.toBe(0);
      expect(bad.stderr).toContain("error:");
      expect(bad.stderr).toContain("--base");

      fx.git("rm", "-q", "m.py");
      fx.commit("nothing to narrate");
      const clean = run("check", "--base", "HEAD");
      expect(clean.status).toBe(0);
      expect(clean.stdout).toBe("");
    } finally {
      fx.cleanup();
    }
  });

  it("rejects a lone artifact name as ambiguous with both explicit forms, and analyzes ./<name> as a directory", () => {
    const fx = gitFixture({ files: { "m.py": "def a():\n    return 1\n", "functions/f.py": "def f():\n    return 2\n" } });
    try {
      const run = (...args: string[]) => spawnSync("npx", ["tsx", binPath, ...args], { encoding: "utf-8", cwd: fx.root });

      const ambiguous = run("analyze", "functions", "--no-llm");
      expect(ambiguous.status).not.toBe(0);
      expect(ambiguous.stderr).toContain(`"functions" is ambiguous`);
      expect(ambiguous.stderr).toContain("scv analyze . functions");
      expect(ambiguous.stderr).toContain("scv analyze ./functions");
      expect(existsSync(path.join(fx.root, "functions", ".scv"))).toBe(false);

      const directory = run("analyze", "./functions", "--no-llm");
      expect(directory.status).toBe(0);
      expect(directory.stderr).not.toMatch(/'scv analyze [a-z]+'/);
      expect(directory.stderr).toContain("'scv analyze ./functions functions'");
    } finally {
      fx.cleanup();
    }
  });
});

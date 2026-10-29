import { spawnSync } from "node:child_process";
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

  it("registers a serve command", () => {
    const result = spawnSync("npx", ["tsx", binPath, "serve", "--help"], { encoding: "utf-8" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("serve the JSON API");
  });

  it("registers a ui command", () => {
    const result = spawnSync("npx", ["tsx", binPath, "ui", "--help"], { encoding: "utf-8" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("serve the built SPA");
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
});

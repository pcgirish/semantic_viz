import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const binPath = fileURLToPath(new URL("../src/bin.ts", import.meta.url));
const run = (...args: string[]) => spawnSync("npx", ["tsx", binPath, ...args], { encoding: "utf-8" });

describe("scv-viewer bin", () => {
  it("registers a serve command", () => {
    const result = run("serve", "--help");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("serve the JSON API");
  });

  it("registers a ui command", () => {
    const result = run("ui", "--help");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("serve the built SPA");
  });

  it("exits non-zero with a clean error message when a command rejects", () => {
    const result = run("ui", "--port", "notaport");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("error:");
    expect(result.stderr).not.toContain("at async");
  });
});

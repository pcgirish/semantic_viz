import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const ignored = (file: string) => spawnSync("git", ["check-ignore", "-q", "--no-index", file], { cwd: repoRoot }).status === 0;

describe(".gitignore", () => {
  it("keeps only the committed store eligible under .scv, at any depth", () => {
    for (const dir of [".scv", "fixtures/demo/.scv"]) {
      expect(ignored(`${dir}/semantics/docs.json`)).toBe(false);
      expect(ignored(`${dir}/semantics/functions/src%2Fa.py.json`)).toBe(false);
      for (const local of ["cache.sqlite", "cache.sqlite-wal", "artifacts/x.json", "config.yaml", ".semantics-staging/docs.json", ".semantics-old/docs.json"]) {
        expect(ignored(`${dir}/${local}`), local).toBe(true);
      }
    }
  });
});

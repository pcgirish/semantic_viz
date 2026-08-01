import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { churnByFile } from "../src/vcs.js";

const orderlyRoot = fileURLToPath(new URL("../../../fixtures/orderly", import.meta.url));

describe("churnByFile on the orderly fixture", () => {
  const churn = churnByFile(orderlyRoot);

  it("reports commits, added/deleted lines, and per-author lines for a known file", () => {
    const routes = churn.get("src/api/routes.py");
    expect(routes).toBeDefined();
    expect(routes!.commits).toBeGreaterThan(0);
    expect(routes!.added + routes!.deleted).toBeGreaterThan(0);
    expect(routes!.authors.size).toBeGreaterThan(0);
  });

  it("returns an empty map for a non-git directory", () => {
    const nonGitDir = mkdtempSync(path.join(tmpdir(), "scv-vcs-test-"));
    const result = churnByFile(nonGitDir);
    expect(result.size).toBe(0);
  });
});

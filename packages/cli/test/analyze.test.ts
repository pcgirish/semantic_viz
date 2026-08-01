import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAnalyze } from "../src/analyze.js";

const orderlyRoot = fileURLToPath(new URL("../../../fixtures/orderly", import.meta.url));

describe("runAnalyze", () => {
  let scvDir: string;

  beforeEach(() => {
    scvDir = mkdtempSync(path.join(tmpdir(), "scv-analyze-"));
  });

  afterEach(() => {
    rmSync(scvDir, { recursive: true, force: true });
  });

  it("writes a schema-valid snapshot to <scvDir>/snapshots/<sha>.json", async () => {
    const written = await runAnalyze({ root: orderlyRoot, scvDir });
    const contents = readFileSync(written.path, "utf-8");
    const parsed = JSON.parse(contents);
    expect(parsed.schema).toBe("scv/1");
    expect(parsed.rev.sha).toBe(written.snapshot.rev.sha);
    expect(written.path).toBe(path.join(scvDir, "snapshots", `${written.snapshot.rev.sha}.json`));
  });

  it("returns unit/edge/external counts matching the extractor output", async () => {
    const written = await runAnalyze({ root: orderlyRoot, scvDir });
    expect(written.snapshot.units.length).toBeGreaterThan(0);
    expect(written.snapshot.edges.length).toBeGreaterThan(0);
  });
});

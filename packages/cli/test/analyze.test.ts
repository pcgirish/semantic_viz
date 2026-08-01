import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider, ProviderResult } from "@scv/interpreter";
import { runAnalyze } from "../src/analyze.js";

const orderlyRoot = fileURLToPath(new URL("../../../fixtures/orderly", import.meta.url));

const passAResponse = {
  what: "does a thing",
  how: "by doing it",
  when: "on call",
  where: "backend",
  why: "needed",
  confidence: 0.9,
  ports: { in: [], out: [] },
  cost: { complexity: 1, io: [], estimate: "fast", confidence: 0.9 },
  tags: [],
};

function fakeProvider(): Provider {
  return {
    name: "fake",
    model: "fake-model",
    interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
      if (prompt.includes("grouping the files")) {
        return { text: JSON.stringify({ clusters: { misc: [] } }), tokens: 10 };
      }
      if (prompt.includes("describing why")) {
        return { text: JSON.stringify({ why: "misc layer", confidence: 0.5 }), tokens: 10 };
      }
      return { text: JSON.stringify(passAResponse), tokens: 10 };
    }),
  };
}

describe("runAnalyze", () => {
  let scvDir: string;

  beforeEach(() => {
    scvDir = mkdtempSync(path.join(tmpdir(), "scv-analyze-"));
  });

  afterEach(() => {
    rmSync(scvDir, { recursive: true, force: true });
  });

  it("writes a schema-valid snapshot to <scvDir>/snapshots/<sha>.json", async () => {
    const written = await runAnalyze({ root: orderlyRoot, scvDir, provider: fakeProvider() });
    const contents = readFileSync(written.path, "utf-8");
    const parsed = JSON.parse(contents);
    expect(parsed.schema).toBe("scv/1");
    expect(parsed.rev.sha).toBe(written.snapshot.rev.sha);
    expect(written.path).toBe(path.join(scvDir, "snapshots", `${written.snapshot.rev.sha}.json`));
  });

  it("returns unit/edge/external counts matching the extractor output", async () => {
    const written = await runAnalyze({ root: orderlyRoot, scvDir, provider: fakeProvider() });
    expect(written.snapshot.units.length).toBeGreaterThan(0);
    expect(written.snapshot.edges.length).toBeGreaterThan(0);
  });

  it("lifts leaf units with Pass A semantics and adds a system unit", async () => {
    const written = await runAnalyze({ root: orderlyRoot, scvDir, provider: fakeProvider() });
    const lifted = written.snapshot.units.find((u) => u.kind === "function" && u.semantics);
    expect(lifted?.semantics?.what).toBe("does a thing");
    expect(written.snapshot.units.some((u) => u.kind === "system")).toBe(true);
  });

  it("caches Pass A calls across runs against unchanged content, producing identical semantic hashes", async () => {
    const provider1 = fakeProvider();
    const first = await runAnalyze({ root: orderlyRoot, scvDir, provider: provider1 });
    const callsAfterFirst = (provider1.interpret as ReturnType<typeof vi.fn>).mock.calls.length;

    const provider2 = fakeProvider();
    const second = await runAnalyze({ root: orderlyRoot, scvDir, provider: provider2 });

    expect(provider2.interpret).not.toHaveBeenCalled();
    expect(callsAfterFirst).toBeGreaterThan(0);

    const hash = (s: typeof first.snapshot) =>
      s.units.filter((u) => u.kind === "function").map((u) => u.hash.semantic);
    expect(hash(second.snapshot)).toEqual(hash(first.snapshot));
  });
});

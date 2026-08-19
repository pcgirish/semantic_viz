import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
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

/**
 * Distinctive opening substring of every prompt the pipeline can issue, mapped to a
 * canned response matching that pass's schema. Keyed on prompt text rather than call
 * order because passes interleave. Unmatched prompts throw (see `fakeProvider`) so a
 * prompt reword fails loudly here instead of as a schema error three passes downstream.
 */
const PROMPT_RESPONSES: [match: string, response: (prompt: string) => unknown][] = [
  ["extracting structural signal", () => ({ purpose: "A fixture repo.", modules: [], architecture_notes: [] })],
  ["grouping a codebase's directories", () => ({ merges: {} })],
  ["proposing merges of a codebase's architectural layers", () => ({ merges: {} })],
  ["describing why the following cluster of files", () => ({
    what: "misc what", how: "misc how", when: "misc when", where: "misc where", why: "misc layer", confidence: 0.5,
  })],
  ["identifying api_flow", () => ({ flows: [] })],
  ["describing an api_flow named", () => ({
    what: "flow what", how: "flow how", when: "flow when", where: "flow where", why: "flow why",
    tags: [], confidence: 0.5,
  })],
  ["labeling the control-flow blocks", (prompt) => ({
    labels: [...prompt.matchAll(/- id: (\S+)/g)].map((m) => ({ blockId: m[1], label: "step" })),
  })],
  ["assessing the risk", () => ({
    axes: { functionality: 0.1, availability: 0.1, scalability: 0.1, performance: 0.1, security: 0.1 },
    why: "low risk", confidence: 0.5,
  })],
  ["ranking a list of changed code units", (prompt) => {
    const count = [...prompt.matchAll(/^\s*\d+\.\s/gm)].length;
    return { ranked: Array.from({ length: count }, (_, i) => i + 1) };
  }],
  ["analyzing a single", () => passAResponse],
];

/** Prompt-opening substrings for every pass except Pass A, for filtering mock call lists. */
const NON_PASS_A_PROMPTS = PROMPT_RESPONSES.map(([match]) => match).filter(
  (match) => match !== "analyzing a single",
);

/** Counts Pass A (per-unit semantics) calls only, excluding every other pass's prompt. */
function countPassACalls(provider: Provider): number {
  return (provider.interpret as ReturnType<typeof vi.fn>).mock.calls.filter(
    (call) => !NON_PASS_A_PROMPTS.some((match) => String(call[0]).includes(match)),
  ).length;
}

function fakeProvider(): Provider {
  return {
    name: "fake",
    model: "fake-model",
    interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
      const entry = PROMPT_RESPONSES.find(([match]) => prompt.includes(match));
      if (!entry) {
        throw new Error(`fakeProvider: unrecognized prompt, mock is stale. First 200 chars:\n${prompt.slice(0, 200)}`);
      }
      return { text: JSON.stringify(entry[1](prompt)), tokens: 10 };
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

  it("returns input/output token usage for the analysis run", async () => {
    const provider = fakeProvider();
    const written = await runAnalyze({ root: orderlyRoot, scvDir, provider });
    const callCount = (provider.interpret as ReturnType<typeof vi.fn>).mock.calls.length;

    expect(written.usage).toMatchObject({ calls: callCount, cacheHits: 0, inputTokens: 0, outputTokens: callCount * 10 });
  });

  it("returns total wall-clock elapsed time for the analysis run", async () => {
    const written = await runAnalyze({ root: orderlyRoot, scvDir, provider: fakeProvider() });
    expect(written.elapsedMs).toBeGreaterThanOrEqual(0);
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

  it("writes provider/model to .scv/config.yaml when passed as options, even on first run", async () => {
    expect(existsSync(`${scvDir}/config.yaml`)).toBe(false);

    await runAnalyze({
      root: orderlyRoot,
      scvDir,
      provider: fakeProvider(),
      providerName: "anthropic",
      model: "claude-sonnet-5",
    });

    const raw = readFileSync(`${scvDir}/config.yaml`, "utf-8");
    expect(raw).toContain("provider: anthropic");
    expect(raw).toContain("model: claude-sonnet-5");
  });

  it("writes effort to .scv/config.yaml when passed", async () => {
    await runAnalyze({
      root: orderlyRoot,
      scvDir,
      provider: fakeProvider(),
      providerName: "claude-cli",
      effort: "high",
    });

    const raw = readFileSync(`${scvDir}/config.yaml`, "utf-8");
    expect(raw).toContain("effort: high");
  });

  it("does not write config.yaml when no provider/model/effort options are given", async () => {
    await runAnalyze({ root: orderlyRoot, scvDir, provider: fakeProvider() });
    expect(existsSync(`${scvDir}/config.yaml`)).toBe(false);
  });

  it("writes logLevel to .scv/config.yaml when passed", async () => {
    await runAnalyze({
      root: orderlyRoot,
      scvDir,
      provider: fakeProvider(),
      logLevel: "info",
    });

    const raw = readFileSync(`${scvDir}/config.yaml`, "utf-8");
    expect(raw).toContain("logLevel: info");
  });

  it("--no-llm produces a static-only snapshot with no LLM calls", async () => {
    const provider = fakeProvider();
    const written = await runAnalyze({ root: orderlyRoot, scvDir, provider, noLlm: true });

    expect(provider.interpret).not.toHaveBeenCalled();
    expect(written.snapshot.units.length).toBeGreaterThan(0);
    expect(written.snapshot.units.every((u) => u.semantics === null)).toBe(true);
    expect(written.snapshot.units.some((u) => u.kind === "system")).toBe(false);
  });

  it("computing just 'functions' then 'layers' reuses the persisted functions artifact without recalling Pass A", async () => {
    const provider1 = fakeProvider();
    await runAnalyze({ root: orderlyRoot, scvDir, provider: provider1, artifact: "functions" });
    const passACallsAfterFunctions = countPassACalls(provider1);
    expect(passACallsAfterFunctions).toBeGreaterThan(0);

    const provider2 = fakeProvider();
    await runAnalyze({ root: orderlyRoot, scvDir, provider: provider2, artifact: "layers" });
    const passACallsOnLayersRun = countPassACalls(provider2);
    expect(passACallsOnLayersRun).toBe(0);
  });

  it("running analyze twice with no changes performs zero LLM calls on the second run", async () => {
    await runAnalyze({ root: orderlyRoot, scvDir, provider: fakeProvider() });

    const provider2 = fakeProvider();
    await runAnalyze({ root: orderlyRoot, scvDir, provider: provider2 });

    expect(provider2.interpret).not.toHaveBeenCalled();
  });

  it("--force without a target artifact rejects with a clear error", async () => {
    await expect(runAnalyze({ root: orderlyRoot, scvDir, provider: fakeProvider(), force: true })).rejects.toThrow(
      /--force requires a target artifact/,
    );
  });

  it("--force layers recomputes layers's artifact file without touching functions's, even though inputs are unchanged", async () => {
    const first = await runAnalyze({ root: orderlyRoot, scvDir, provider: fakeProvider(), artifact: "layers" });
    const sha = first.snapshot.rev.sha;
    const functionsFile = path.join(scvDir, "artifacts", sha, "functions.json");
    const layersFile = path.join(scvDir, "artifacts", sha, "layers.json");

    const functionsBefore = statSync(functionsFile).mtimeMs;
    const layersBefore = statSync(layersFile).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 5));

    await runAnalyze({ root: orderlyRoot, scvDir, provider: fakeProvider(), artifact: "layers", force: true });

    expect(statSync(functionsFile).mtimeMs).toBe(functionsBefore);
    expect(statSync(layersFile).mtimeMs).toBeGreaterThan(layersBefore);
  });
});

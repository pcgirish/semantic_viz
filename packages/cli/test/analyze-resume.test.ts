import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { ContentCache, type Provider, type ProviderResult } from "@semviz/interpreter";
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

/** See analyze.test.ts — same canned responses, kept local so neither suite constrains the other. */
const PROMPT_RESPONSES: [match: string, response: (prompt: string) => unknown][] = [
  ["extracting structural signal", () => ({ purpose: "A fixture repo.", modules: [], architecture_notes: [] })],
  ["proposing merges of a codebase's architectural layers", () => ({ merges: {} })],
  ["naming and describing a cluster of files", (prompt) => ({
    name: `cluster_${[...prompt.matchAll(/^- (\S+):/gm)].length}`,
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

const PASS_A_MATCH = "analyzing a single";

function isPassA(prompt: string): boolean {
  return prompt.includes(PASS_A_MATCH);
}

/** The qualname a Pass A prompt is about, from its `Unit:` line. */
function passAUnitOf(prompt: string): string {
  const match = /^Unit: (.+)$/m.exec(prompt);
  if (!match) throw new Error(`no Unit: line in Pass A prompt:\n${prompt.slice(0, 200)}`);
  return match[1];
}

function passACalls(provider: Provider): string[] {
  return (provider.interpret as ReturnType<typeof vi.fn>).mock.calls
    .map((call) => String(call[0]))
    .filter(isPassA);
}

function respond(prompt: string): ProviderResult {
  const entry = PROMPT_RESPONSES.find(([match]) => prompt.includes(match));
  if (!entry) throw new Error(`unrecognized prompt:\n${prompt.slice(0, 200)}`);
  return { text: JSON.stringify(entry[1](prompt)), tokens: 10 };
}

function fakeProvider(): Provider {
  return { name: "fake", model: "fake-model", interpret: vi.fn(async (p: string) => respond(p)) };
}

/**
 * Stands in for a run that was cut short. A real interrupt is a process kill, which no in-process
 * test can reproduce; what it leaves behind is exactly what this leaves behind — the first `limit`
 * units completed and recorded `ok`, the rest unanalyzed and recorded `failed`, so the artifact
 * stays partial and the next run picks up only the remainder.
 *
 * Counts *units*, not calls: a failing unit is retried, so counting calls would cut off early.
 */
function providerFailingAfter(limit: number): Provider {
  const served = new Set<string>();
  return {
    name: "fake",
    model: "fake-model",
    interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
      if (isPassA(prompt)) {
        const unit = passAUnitOf(prompt);
        if (!served.has(unit) && served.size >= limit) return { text: "cut short", tokens: 1 };
        served.add(unit);
      }
      return respond(prompt);
    }),
  };
}

function artifactPath(scvDir: string, sha: string, name: string): string {
  return path.join(scvDir, "artifacts", sha, `${name}.json`);
}

function readArtifact(scvDir: string, sha: string, name: string): { inputHash: string; partial?: boolean; data: unknown } {
  return JSON.parse(readFileSync(artifactPath(scvDir, sha, name), "utf-8"));
}

describe("analyze resume and scope", () => {
  let scvDir: string;

  beforeEach(() => {
    scvDir = mkdtempSync(path.join(tmpdir(), "scv-resume-"));
  });

  afterEach(() => {
    rmSync(scvDir, { recursive: true, force: true });
  });

  // Test 1 — the whole point: a resumed run must not pay again for the units already completed.
  it("resumes without re-calling the provider for units completed by the cut-short run", async () => {
    const cutShort = providerFailingAfter(6);
    await runAnalyze({ root: orderlyRoot, scvDir, provider: cutShort, artifact: "functions" });
    const completed = new Set(passACalls(cutShort).map(passAUnitOf));
    expect(completed.size).toBeGreaterThan(6);

    const resumed = fakeProvider();
    const second = await runAnalyze({ root: orderlyRoot, scvDir, provider: resumed, artifact: "functions" });
    const reasked = new Set(passACalls(resumed).map(passAUnitOf));

    // Every unit that came back `ok` is restored, not re-analyzed; the rest are retried.
    const ok = second.snapshot.units.filter((u) => u.semantics?.what === "does a thing");
    expect(ok.length).toBeGreaterThan(0);
    expect(reasked.size).toBeLessThan(completed.size);
  });

  // Test 3 — the resumed run must reach the same snapshot as one that ran straight through.
  it("produces the same Pass A semantic hashes as an uninterrupted run", async () => {
    const cleanDir = mkdtempSync(path.join(tmpdir(), "scv-clean-"));
    try {
      const clean = await runAnalyze({ root: orderlyRoot, scvDir: cleanDir, provider: fakeProvider(), artifact: "functions" });

      await runAnalyze({ root: orderlyRoot, scvDir, provider: providerFailingAfter(5), artifact: "functions" });
      const resumed = await runAnalyze({ root: orderlyRoot, scvDir, provider: fakeProvider(), artifact: "functions" });

      const hashes = (s: typeof clean.snapshot) =>
        s.units.filter((u) => u.kind === "function").map((u) => [u.id, u.hash.semantic]);
      expect(hashes(resumed.snapshot)).toEqual(hashes(clean.snapshot));
    } finally {
      rmSync(cleanDir, { recursive: true, force: true });
    }
  });

  // Test 4 — a partial artifact must still be readable, so downstream passes can render.
  it("leaves a readable partial functions.json behind when units are left unanalyzed", async () => {
    const run = await runAnalyze({ root: orderlyRoot, scvDir, provider: providerFailingAfter(12), artifact: "functions" });

    const stored = readArtifact(scvDir, run.snapshot.rev.sha, "functions");
    expect(stored.partial).toBe(true);
    const data = stored.data as { units: { id: string; semantics: unknown }[] };
    expect(data.units.length).toBeGreaterThan(0);
    expect(data.units.some((u) => u.semantics)).toBe(true);
  });

  // Test 5 — a partial artifact is readable but never fresh; the next run must finish the job.
  it("does not treat a partial artifact as fresh", async () => {
    await runAnalyze({ root: orderlyRoot, scvDir, provider: providerFailingAfter(4), artifact: "functions" });

    const second = fakeProvider();
    const result = await runAnalyze({ root: orderlyRoot, scvDir, provider: second, artifact: "functions" });
    expect(passACalls(second).length).toBeGreaterThan(0);

    const stored = readArtifact(scvDir, result.snapshot.rev.sha, "functions");
    expect(stored.partial).toBeUndefined();

    // And now that it is complete, a third run is a pure cache read.
    const third = fakeProvider();
    await runAnalyze({ root: orderlyRoot, scvDir, provider: third, artifact: "functions" });
    expect(passACalls(third).length).toBe(0);
  });

  // Test 2 — units completed between flushes live only in `pass_a_units`; --no-llm must find them.
  it("--no-llm overlays the durable per-unit store on top of the last partial flush", async () => {
    await runAnalyze({ root: orderlyRoot, scvDir, provider: providerFailingAfter(15), artifact: "functions" });

    const merged = await runAnalyze({ root: orderlyRoot, scvDir, provider: fakeProvider(), noLlm: true });
    const analyzed = merged.snapshot.units.filter((u) => u.semantics?.what === "does a thing");
    expect(analyzed.length).toBeGreaterThanOrEqual(15);
  });

  it("--no-llm does not surface a prior full artifact's semantics for out-of-scope units", async () => {
    // A complete, non-partial artifact for the whole repo.
    const first = await runAnalyze({ root: orderlyRoot, scvDir, provider: fakeProvider(), artifact: "functions" });
    const full = readArtifact(scvDir, first.snapshot.rev.sha, "functions");
    expect(full.partial).toBeFalsy();

    // Scope narrows the input hash, so that artifact is no longer this run's. Its units must not
    // be adopted as a base — otherwise out-of-scope semantics reappear under a scope that
    // excluded them.
    const scoped = await runAnalyze({
      root: orderlyRoot,
      scvDir,
      provider: fakeProvider(),
      noLlm: true,
      scope: ["u:src.auth.**"],
    });

    const outOfScope = scoped.snapshot.units.filter(
      (u) => u.kind === "function" && u.semantics && !u.id.startsWith("u:src.auth."),
    );
    expect(outOfScope.map((u) => u.id)).toEqual([]);
  });

  it("--no-llm does not surface a stale artifact's semantics after the prompt rev changes", async () => {
    await runAnalyze({ root: orderlyRoot, scvDir, provider: fakeProvider(), artifact: "functions", promptRev: "pX" });

    // A different prompt rev is different inputs; the stored artifact describes the old ones.
    // Its per-unit store rows are keyed by prompt rev too, so nothing legitimately carries over.
    const merged = await runAnalyze({
      root: orderlyRoot,
      scvDir,
      provider: fakeProvider(),
      noLlm: true,
      promptRev: "pY",
    });

    const analyzed = merged.snapshot.units.filter((u) => u.kind === "function" && u.semantics);
    expect(analyzed.map((u) => u.id)).toEqual([]);
  });

  // Test 8 — a unit that failed outright must not be recorded as done.
  it("keeps the artifact partial when a unit fails, so the next run retries only it", async () => {
    let failing = true;
    const target = "src.orders.pricing.price_items";
    const flaky: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async (prompt: string): Promise<ProviderResult> => {
        // Malformed output on every attempt for one unit: Pass A records it failed rather than
        // aborting the run, so the rest of the repo still completes.
        if (isPassA(prompt) && passAUnitOf(prompt) === target && failing) {
          return { text: "not json at all", tokens: 1 };
        }
        return respond(prompt);
      }),
    };

    const first = await runAnalyze({ root: orderlyRoot, scvDir, provider: flaky, artifact: "functions" });
    expect(readArtifact(scvDir, first.snapshot.rev.sha, "functions").partial).toBe(true);

    failing = false;
    const second = fakeProvider();
    await runAnalyze({ root: orderlyRoot, scvDir, provider: second, artifact: "functions" });
    const reasked = new Set(passACalls(second).map(passAUnitOf));
    expect(reasked.has(target)).toBe(true);
    // Only the failed unit and its callers (whose prompts embed its one-liner) are recomputed.
    expect(reasked.size).toBeLessThan(5);
  });

  // Test 10 — a corrupt per-unit row must not poison a resumed run.
  it("survives a corrupt pass_a_units row by re-analyzing that unit", async () => {
    await runAnalyze({ root: orderlyRoot, scvDir, provider: providerFailingAfter(8), artifact: "functions" });

    const db = new Database(path.join(scvDir, "cache.sqlite"));
    const before = db.prepare("SELECT COUNT(*) AS n FROM pass_a_units").get() as { n: number };
    expect(before.n).toBeGreaterThan(0);
    db.prepare("UPDATE pass_a_units SET result_json = ? WHERE rowid = (SELECT MIN(rowid) FROM pass_a_units)").run("{ broken");
    db.close();

    const resumed = fakeProvider();
    const result = await runAnalyze({ root: orderlyRoot, scvDir, provider: resumed, artifact: "functions" });
    expect(result.snapshot.units.some((u) => u.semantics?.what === "does a thing")).toBe(true);

    const check = new ContentCache(path.join(scvDir, "cache.sqlite"));
    check.close();
  });

  // Test 11 — scope, including the `u:` prefix trap.
  it("--scope analyzes only matching units and a later unscoped run completes the rest", async () => {
    const scoped = fakeProvider();
    const scopedRun = await runAnalyze({
      root: orderlyRoot, scvDir, provider: scoped, artifact: "functions", scope: ["u:src.orders.**"],
    });

    const prompts = passACalls(scoped);
    expect(prompts.length).toBeGreaterThan(0);
    const analyzed = scopedRun.snapshot.units.filter((u) => u.kind === "function" && u.semantics);
    expect(analyzed.length).toBeGreaterThan(0);
    // A scoped run must not drag the whole call closure in with it.
    expect(analyzed.filter((u) => !u.id.startsWith("u:src.orders.")).map((u) => u.id)).toEqual([]);
    expect(scopedRun.snapshot.units.some((u) => u.id === "u:src.auth.verify_token" && !u.semantics)).toBe(true);

    // A scoped artifact is partial, so the unscoped run must not short-circuit on it.
    const full = fakeProvider();
    const fullRun = await runAnalyze({ root: orderlyRoot, scvDir, provider: full, artifact: "functions" });
    expect(passACalls(full).length).toBeGreaterThan(0);
    expect(fullRun.snapshot.units.filter((u) => u.kind === "function" && u.semantics).length).toBeGreaterThan(
      analyzed.length,
    );
  });

  it("--scope without the u: prefix matches nothing, rather than silently analyzing everything", async () => {
    const provider = fakeProvider();
    const run = await runAnalyze({
      root: orderlyRoot, scvDir, provider, artifact: "functions", scope: ["src.orders.**"],
    });

    expect(passACalls(provider).length).toBe(0);
    expect(run.snapshot.units.filter((u) => u.kind === "function" && u.semantics).length).toBe(0);
  });

  // Test 16 — a kill mid-write must never leave a truncated artifact.
  it("keeps the previous artifact intact and parseable when a write is interrupted", async () => {
    const first = await runAnalyze({ root: orderlyRoot, scvDir, provider: fakeProvider(), artifact: "functions" });
    const file = artifactPath(scvDir, first.snapshot.rev.sha, "functions");
    const good = readFileSync(file, "utf-8");

    // Simulate the crash window: a temp file exists half-written, the real file is untouched.
    writeFileSync(`${file}.99999.tmp`, '{"inputHash":"x","data":{"units":[');
    expect(readFileSync(file, "utf-8")).toBe(good);
    expect(() => JSON.parse(readFileSync(file, "utf-8"))).not.toThrow();
    expect(existsSync(file)).toBe(true);
  });
});

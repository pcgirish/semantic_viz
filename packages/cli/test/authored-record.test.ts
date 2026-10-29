import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SymbolEdge, SymbolGraph, SymbolUnit } from "@scv/extractor";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RECORD_VERSION, readAuthoredRecord, stampAuthored, writeAuthoredRecord } from "../src/authored-record.js";
import { emptyAuthoredSet, evaluate, type AuthoredSet, type FingerprintInputs } from "../src/fingerprints.js";
import { toSnapshot } from "../src/snapshot.js";

function unit(id: string, text = `${id}-text`): SymbolUnit {
  return {
    id,
    kind: "function",
    name: id,
    qualname: id.replace(/^u:/, ""),
    lang: "python",
    parent: null,
    children: [],
    loc: { file: "src/a.py", start: 1, end: 2 },
    sloc: 1,
    params: [],
    returns: null,
    bases: [],
    hash: { struct: `${id}-struct`, text },
    metrics: { fanIn: 0, fanOut: 0, churn: 0, commits: 0 },
    authors: [],
  };
}

function calls(from: string, to: string): SymbolEdge {
  return { id: `${from}>${to}`, from, to, kind: "calls", confidence: 1, evidence: { file: "src/a.py", line: 1 } };
}

function inputs(cText = "u:c-text"): FingerprintInputs {
  const graph: SymbolGraph = {
    units: [unit("u:a"), unit("u:b"), unit("u:c", cText)],
    edges: [calls("u:a", "u:b"), calls("u:b", "u:c")],
    externals: [],
    blockGraph: {},
    routes: [],
  };
  const snapshot = toSnapshot(graph, { root: "/repo", rev: { sha: "s", kind: "commit", ts: "", author: "", author_kind: "human" } });
  return { graph, snapshot, docs: [{ path: "README.md", content: "readme" }] };
}

const sem = (what: string) => ({ kind: "function" as const, semantics: { what, how: "h", when: "n", where: "r", why: "y", confidence: 1 } });

function authored(functions: Record<string, ReturnType<typeof sem>>): AuthoredSet {
  const set = emptyAuthoredSet();
  for (const [id, entry] of Object.entries(functions)) set.functions[id] = { entry };
  return set;
}

describe("stampAuthored", () => {
  it("stamps entries authored now with the current fingerprint and keeps prior stamps as they were", () => {
    const first = stampAuthored(inputs(), emptyAuthoredSet(), authored({ "u:c": sem("c1"), "u:b": sem("b1") }), emptyAuthoredSet());
    const ev = evaluate(inputs(), first, emptyAuthoredSet());
    expect(first.functions["u:c"]!.fingerprint).toBe(ev.functions.get("u:c")!.fingerprint);
    expect(first.functions["u:b"]!.fingerprint).toBe(ev.functions.get("u:b")!.fingerprint);

    // Body edit on c: re-authoring c changes b's inputs, but b keeps its original stamp (now stale).
    const second = stampAuthored(inputs("edited"), first, authored({ "u:c": sem("c2") }), emptyAuthoredSet());
    expect(second.functions["u:b"]!.fingerprint).toBe(first.functions["u:b"]!.fingerprint);
    expect(second.functions["u:c"]!.fingerprint).not.toBe(first.functions["u:c"]!.fingerprint);
    expect(evaluate(inputs("edited"), second, emptyAuthoredSet()).functions.get("u:b")!.primary).toBeUndefined();
  });

  it("drops prior entries whose unit or doc no longer exists", () => {
    const prior = authored({ "u:gone": sem("x") });
    prior.functions["u:gone"]!.fingerprint = "f".repeat(40);
    prior.docs["gone.md"] = { fingerprint: "f".repeat(40), entry: { path: "gone.md", purpose: "p", modules: [], architecture_notes: [] } };
    const record = stampAuthored(inputs(), prior, emptyAuthoredSet(), emptyAuthoredSet());
    expect(record.functions).toEqual({});
    expect(record.docs).toEqual({});
  });

  it("layers a partial re-author over the fresh committed entry, not a stale one", () => {
    const first = stampAuthored(inputs(), emptyAuthoredSet(), authored({ "u:c": sem("c1") }), emptyAuthoredSet());
    const labelsOnly = emptyAuthoredSet();
    labelsOnly.functions["u:c"] = { entry: { kind: "function", blockLabels: { "decision:0": { label: "check" } } } };

    const fresh = stampAuthored(inputs(), first, labelsOnly, emptyAuthoredSet());
    expect(fresh.functions["u:c"]!.entry).toEqual({ ...sem("c1"), blockLabels: { "decision:0": { label: "check" } } });

    const stale = stampAuthored(inputs("edited"), first, labelsOnly, emptyAuthoredSet());
    expect(stale.functions["u:c"]!.entry).toEqual({ kind: "function", blockLabels: { "decision:0": { label: "check" } } });

    const staleStore = stampAuthored(inputs("edited"), emptyAuthoredSet(), labelsOnly, first);
    expect(staleStore.functions["u:c"]!.entry).toEqual({ kind: "function", blockLabels: { "decision:0": { label: "check" } } });
  });

  it("stamps global narration authored now and keeps the prior stamp otherwise", () => {
    const now = emptyAuthoredSet();
    now.flows = { entry: {} };
    const first = stampAuthored(inputs(), emptyAuthoredSet(), now, emptyAuthoredSet());
    expect(first.flows!.fingerprint).toBe(evaluate(inputs(), emptyAuthoredSet(), emptyAuthoredSet()).flows.fingerprint);
    const second = stampAuthored(inputs("edited"), first, emptyAuthoredSet(), emptyAuthoredSet());
    expect(second.flows).toEqual(first.flows);
  });
});

describe("authored record on disk", () => {
  let scvDir: string;
  beforeEach(() => {
    scvDir = mkdtempSync(path.join(tmpdir(), "scv-authored-"));
  });
  afterEach(() => rmSync(scvDir, { recursive: true, force: true }));

  it("round-trips and reads a missing record as empty", () => {
    expect(readAuthoredRecord(scvDir, "sha1")).toEqual(emptyAuthoredSet());
    const record = stampAuthored(inputs(), emptyAuthoredSet(), authored({ "u:c": sem("c1") }), emptyAuthoredSet());
    writeAuthoredRecord(scvDir, "sha1", record);
    expect(readAuthoredRecord(scvDir, "sha1")).toEqual(record);
  });

  it("rejects an unknown recordVersion and malformed records", () => {
    const record = stampAuthored(inputs(), emptyAuthoredSet(), authored({ "u:c": sem("c1") }), emptyAuthoredSet());
    writeAuthoredRecord(scvDir, "sha1", record);
    const file = path.join(scvDir, "artifacts", "sha1", "authored.json");
    const raw = JSON.parse(readFileSync(file, "utf-8"));
    writeFileSync(file, JSON.stringify({ ...raw, recordVersion: RECORD_VERSION + 1 }));
    expect(() => readAuthoredRecord(scvDir, "sha1")).toThrow(/recordVersion/);
    writeFileSync(file, "{nope");
    expect(() => readAuthoredRecord(scvDir, "sha1")).toThrow(/authored\.json/);
  });

  it("does not create a file for an empty record", () => {
    writeAuthoredRecord(scvDir, "sha1", emptyAuthoredSet());
    expect(() => readFileSync(path.join(scvDir, "artifacts", "sha1", "authored.json"))).toThrow();
  });
});

import type { SymbolEdge, SymbolGraph, SymbolUnit } from "@scv/extractor";
import { describe, expect, it } from "vitest";
import { docFingerprint, functionFingerprints } from "../src/fingerprints.js";

function unit(id: string, kind: SymbolUnit["kind"] = "function", text = `${id}-text`): SymbolUnit {
  return {
    id,
    kind,
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

function graph(units: SymbolUnit[], edges: SymbolEdge[]): SymbolGraph {
  return { units, edges, externals: [], blockGraph: {}, routes: [] };
}

const none = () => undefined;

describe("functionFingerprints", () => {
  const base = () => graph([unit("u:a"), unit("u:b"), unit("u:c"), unit("u:m", "module")], [calls("u:a", "u:b"), calls("u:b", "u:c")]);

  it("fingerprints only function and class units, deterministically", () => {
    const first = functionFingerprints(base(), none);
    expect([...first.keys()].sort()).toEqual(["u:a", "u:b", "u:c"]);
    for (const fp of first.values()) expect(fp).toMatch(/^[0-9a-f]{40}$/);
    expect(functionFingerprints(base(), none)).toEqual(first);
  });

  it("changes on a body-only edit", () => {
    const edited = base();
    edited.units[1] = unit("u:b", "function", "edited");
    const before = functionFingerprints(base(), none);
    const after = functionFingerprints(edited, none);
    expect(after.get("u:b")).not.toBe(before.get("u:b"));
    expect(after.get("u:c")).toBe(before.get("u:c"));
  });

  it("changes the caller and callee on an edge-only change", () => {
    const rewired = base();
    rewired.edges.push(calls("u:a", "u:c"));
    const before = functionFingerprints(base(), none);
    const after = functionFingerprints(rewired, none);
    expect(after.get("u:a")).not.toBe(before.get("u:a"));
    expect(after.get("u:c")).not.toBe(before.get("u:c"));
    expect(after.get("u:b")).toBe(before.get("u:b"));
  });

  it("changes a direct caller when a callee's committed semantics change, not a transitive one", () => {
    const sem = (what: string) => (id: string) => (id === "u:c" ? { kind: "function" as const, semantics: { what, how: "", when: "", where: "", why: "", confidence: 1 } } : undefined);
    const before = functionFingerprints(base(), sem("one"));
    const after = functionFingerprints(base(), sem("two"));
    expect(after.get("u:b")).not.toBe(before.get("u:b"));
    expect(after.get("u:a")).toBe(before.get("u:a"));
    expect(after.get("u:c")).toBe(before.get("u:c"));
  });

  it("ignores a callee's non-semantics fields such as block labels", () => {
    const semantics = { what: "w", how: "", when: "", where: "", why: "", confidence: 1 };
    const labelled = (label: string) => (id: string) =>
      id === "u:c" ? { kind: "function" as const, semantics, blockLabels: { "decision:0": { label } } } : undefined;
    expect(functionFingerprints(base(), labelled("two")).get("u:b")).toBe(functionFingerprints(base(), labelled("one")).get("u:b"));
  });

  it("resolves callees before callers, passing each callee's own fingerprint", () => {
    const seen: string[] = [];
    const fps = functionFingerprints(base(), (id, fp) => {
      seen.push(id);
      expect(fp).toMatch(/^[0-9a-f]{40}$/);
      return undefined;
    });
    expect(seen.indexOf("u:c")).toBeLessThan(seen.indexOf("u:b"));
    expect(seen.indexOf("u:b")).toBeLessThan(seen.indexOf("u:a"));
    expect(fps.size).toBe(3);
  });

  it("excludes callees in the unit's own recursion cycle from the digest", () => {
    const cyclic = () => graph([unit("u:x"), unit("u:y"), unit("u:z")], [calls("u:x", "u:y"), calls("u:y", "u:x"), calls("u:y", "u:z")]);
    const sem = (who: string, what: string) => (id: string) => (id === who ? { kind: "function" as const, semantics: { what, how: "", when: "", where: "", why: "", confidence: 1 } } : undefined);

    expect(functionFingerprints(cyclic(), sem("u:x", "two")).get("u:y")).toBe(functionFingerprints(cyclic(), sem("u:x", "one")).get("u:y"));
    expect(functionFingerprints(cyclic(), sem("u:z", "two")).get("u:y")).not.toBe(functionFingerprints(cyclic(), sem("u:z", "one")).get("u:y"));
  });

  it("handles a long call chain without recursion limits", () => {
    const n = 20000;
    const units = Array.from({ length: n }, (_, i) => unit(`u:f${i}`));
    const edges = Array.from({ length: n - 1 }, (_, i) => calls(`u:f${i}`, `u:f${i + 1}`));
    expect(functionFingerprints(graph(units, edges), none).size).toBe(n);
  });
});

describe("docFingerprint", () => {
  it("depends on path and content", () => {
    expect(docFingerprint("README.md", "x")).toMatch(/^[0-9a-f]{40}$/);
    expect(docFingerprint("README.md", "x")).toBe(docFingerprint("README.md", "x"));
    expect(docFingerprint("README.md", "y")).not.toBe(docFingerprint("README.md", "x"));
    expect(docFingerprint("docs/a.md", "x")).not.toBe(docFingerprint("README.md", "x"));
  });
});

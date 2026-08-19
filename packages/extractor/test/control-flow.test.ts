import { describe, expect, it } from "vitest";
import Parser from "tree-sitter";
import { createRequire } from "node:module";
import { walkTypeScriptFile } from "../src/walk-typescript.js";
import { walkPythonFile } from "../src/walk-python.js";
import type { BlockFact, ControlFlowEdgeFact, Fact } from "../src/facts.js";

const require = createRequire(import.meta.url);
const { tsx } = require("tree-sitter-typescript") as { tsx: unknown };
const Python = require("tree-sitter-python") as unknown;

function tsFacts(src: string): Fact[] {
  const parser = new Parser();
  parser.setLanguage(tsx as Parser.Language);
  return walkTypeScriptFile(parser.parse(src), src, "f.ts");
}

function pyFacts(src: string): Fact[] {
  const parser = new Parser();
  parser.setLanguage(Python as Parser.Language);
  return walkPythonFile(parser.parse(src), src, "f.py");
}

function blocks(facts: Fact[]): BlockFact[] {
  return facts.filter((f): f is BlockFact => f.kind === "block");
}
function edges(facts: Fact[]): ControlFlowEdgeFact[] {
  return facts.filter((f): f is ControlFlowEdgeFact => f.kind === "cf_edge");
}

describe("collectControlFlow — TypeScript", () => {
  it("if/else produces decision + 2 branches + merge with 3 edges", () => {
    const facts = tsFacts(`function f(x) { if (x > 0) { a(); } else { b(); } c(); }`);
    const bs = blocks(facts);
    const es = edges(facts);
    expect(bs.some((b) => b.blockType === "decision")).toBe(true);
    expect(bs.some((b) => b.blockType === "merge")).toBe(true);
    expect(es.some((e) => e.edgeType === "true")).toBe(true);
    expect(es.some((e) => e.edgeType === "false")).toBe(true);
    expect(es.length).toBeGreaterThanOrEqual(3);
  });

  it("nested if produces nested decisions with correct merge ordering", () => {
    const facts = tsFacts(`function f(x) {
      if (x > 0) {
        if (x > 10) { a(); } else { b(); }
      } else {
        c();
      }
    }`);
    const bs = blocks(facts);
    const decisions = bs.filter((b) => b.blockType === "decision");
    expect(decisions.length).toBe(2);
    const merges = bs.filter((b) => b.blockType === "merge");
    expect(merges.length).toBe(2);
  });

  it("loop with early return inside produces loop-back and early-return edges", () => {
    const facts = tsFacts(`function f(xs) {
      for (const y of xs) {
        if (y) { return y; }
      }
    }`);
    const bs = blocks(facts);
    const es = edges(facts);
    expect(bs.some((b) => b.blockType === "loop")).toBe(true);
    expect(bs.some((b) => b.blockType === "exit")).toBe(true);
    expect(es.some((e) => e.edgeType === "loop-back")).toBe(true);
  });

  it("try/catch produces an exception edge", () => {
    const facts = tsFacts(`function f() { try { risky(); } catch (e) { handle(e); } }`);
    const bs = blocks(facts);
    const es = edges(facts);
    expect(bs.some((b) => b.blockType === "try")).toBe(true);
    expect(bs.some((b) => b.blockType === "catch")).toBe(true);
    expect(es.some((e) => e.edgeType === "exception")).toBe(true);
  });

  it("switch with 3 non-fallthrough cases produces 3 chained decisions each edging to merge", () => {
    const facts = tsFacts(`function f(x) {
      switch (x) {
        case 1: a(); break;
        case 2: b(); break;
        default: c();
      }
    }`);
    const bs = blocks(facts);
    const decisions = bs.filter((b) => b.blockType === "decision");
    expect(decisions.length).toBe(3);
  });

  it("switch fallthrough case (no break) edges sequentially into the next case", () => {
    const facts = tsFacts(`function f(x) {
      switch (x) {
        case 1: a();
        case 2: b(); break;
        default: c();
      }
    }`);
    const es = edges(facts);
    expect(es.some((e) => e.edgeType === "sequential")).toBe(true);
  });

  it("throw produces an exception edge to an exit block", () => {
    const facts = tsFacts(`function f() { throw new Error("x"); }`);
    const bs = blocks(facts);
    const es = edges(facts);
    expect(bs.some((b) => b.blockType === "exit")).toBe(true);
    expect(es.some((e) => e.edgeType === "exception")).toBe(true);
  });

  it("throw inside an if-branch keeps the branch's true/false edgeType, not exception", () => {
    const facts = tsFacts(`function f(ok) { if (!ok) { throw new Error("x"); } }`);
    const es = edges(facts);
    expect(es.some((e) => e.edgeType === "true")).toBe(true);
    expect(es.some((e) => e.edgeType === "exception")).toBe(false);
  });

  it("plain sequential statements between control nodes stay one sequential block", () => {
    const facts = tsFacts(`function f() {\n  a();\n  b();\n  c();\n  if (x) { d(); }\n}`);
    const bs = blocks(facts);
    const seq = bs.filter((b) => b.blockType === "sequential" && b.startLine <= 4);
    expect(seq.length).toBe(1);
  });

  it("re-extracting the same function twice yields identical blockIds", () => {
    const src = `function f(x) { if (x > 0) { a(); } else { b(); } }`;
    const f1 = blocks(tsFacts(src)).map((b) => b.blockId);
    const f2 = blocks(tsFacts(src)).map((b) => b.blockId);
    expect(f1).toEqual(f2);
  });

  it("a function with no branching produces no decision/loop blocks", () => {
    const facts = tsFacts(`function f() { a(); b(); }`);
    const bs = blocks(facts);
    expect(bs.some((b) => b.blockType === "decision" || b.blockType === "loop")).toBe(false);
  });
});

describe("collectControlFlow — Python", () => {
  it("if/elif/else produces chained decisions", () => {
    const facts = pyFacts(`def f(x):\n    if x > 0:\n        a()\n    elif x < 0:\n        b()\n    else:\n        c()\n`);
    const bs = blocks(facts);
    const decisions = bs.filter((b) => b.blockType === "decision");
    expect(decisions.length).toBe(2);
  });

  it("for loop with early return produces loop-back and early-return edges", () => {
    const facts = pyFacts(`def f(xs):\n    for y in xs:\n        if y:\n            return y\n`);
    const bs = blocks(facts);
    const es = edges(facts);
    expect(bs.some((b) => b.blockType === "loop")).toBe(true);
    expect(es.some((e) => e.edgeType === "loop-back")).toBe(true);
  });

  it("while loop produces a loop block and loop-back edge", () => {
    const facts = pyFacts(`def f(x):\n    while x:\n        x -= 1\n`);
    const bs = blocks(facts);
    const es = edges(facts);
    expect(bs.some((b) => b.blockType === "loop")).toBe(true);
    expect(es.some((e) => e.edgeType === "loop-back")).toBe(true);
  });

  it("try/except produces an exception edge", () => {
    const facts = pyFacts(`def f():\n    try:\n        risky()\n    except Exception as e:\n        handle(e)\n`);
    const bs = blocks(facts);
    const es = edges(facts);
    expect(bs.some((b) => b.blockType === "try")).toBe(true);
    expect(bs.some((b) => b.blockType === "catch")).toBe(true);
    expect(es.some((e) => e.edgeType === "exception")).toBe(true);
  });

  it("match with 3 cases produces 3 chained decisions, no fallthrough (all edge to merge)", () => {
    const facts = pyFacts(`def f(x):\n    match x:\n        case 1:\n            a()\n        case 2:\n            b()\n        case _:\n            c()\n`);
    const bs = blocks(facts);
    const decisions = bs.filter((b) => b.blockType === "decision");
    expect(decisions.length).toBe(3);
    // no fallthrough: no decision-to-decision "sequential" edge (only decision-to-body
    // "true" and decision-to-next-decision "false" edges chain the cases)
    const es = edges(facts);
    const decisionIds = new Set(decisions.map((d) => d.blockId));
    const decisionToDecisionSequential = es.some(
      (e) => e.edgeType === "sequential" && decisionIds.has(e.fromBlock) && decisionIds.has(e.toBlock),
    );
    expect(decisionToDecisionSequential).toBe(false);
  });

  it("raise produces an exception edge to an exit block", () => {
    const facts = pyFacts(`def f():\n    raise ValueError("x")\n`);
    const bs = blocks(facts);
    const es = edges(facts);
    expect(bs.some((b) => b.blockType === "exit")).toBe(true);
    expect(es.some((e) => e.edgeType === "exception")).toBe(true);
  });

  it("raise inside an if-branch keeps the branch's true/false edgeType, not exception", () => {
    const facts = pyFacts(`def f(ok):\n    if not ok:\n        raise ValueError("x")\n`);
    const es = edges(facts);
    expect(es.some((e) => e.edgeType === "true")).toBe(true);
    expect(es.some((e) => e.edgeType === "exception")).toBe(false);
  });

  it("re-extracting the same function twice yields identical blockIds", () => {
    const src = `def f(x):\n    if x > 0:\n        a()\n    else:\n        b()\n`;
    const f1 = blocks(pyFacts(src)).map((b) => b.blockId);
    const f2 = blocks(pyFacts(src)).map((b) => b.blockId);
    expect(f1).toEqual(f2);
  });

  it("a function with no branching produces no decision/loop blocks", () => {
    const facts = pyFacts(`def f():\n    a()\n    b()\n`);
    const bs = blocks(facts);
    expect(bs.some((b) => b.blockType === "decision" || b.blockType === "loop")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { displayName, pathLeaf } from "../src/layout.js";
import type { Unit } from "@semviz/schema";

function makeUnit(overrides: Partial<Unit> & { id: string }): Unit {
  return {
    kind: "module",
    name: overrides.id,
    qualname: overrides.id,
    parent: null,
    children: [],
    loc: { files: [], sloc: 10 },
    tags: [],
    metrics: {},
    hash: { struct: null, text: null, semantic: null },
    provenance: { source: "static" },
    ...overrides,
  };
}

describe("pathLeaf", () => {
  it("takes the leaf of a posix path", () => {
    expect(pathLeaf("packages/ui/src/App.tsx")).toBe("App.tsx");
  });

  it("takes the leaf of a windows path", () => {
    // Snapshots captured on Windows record backslash separators. Splitting on "/" alone
    // left the whole path on screen, which is the entire thing this helper exists to avoid.
    expect(pathLeaf("packages\\ui\\src\\App.tsx")).toBe("App.tsx");
  });

  it("takes the leaf of an absolute windows path, drive letter and all", () => {
    expect(pathLeaf("C:\\Users\\dev\\projects\\semantic_viz")).toBe("semantic_viz");
  });

  it("handles a path that mixes both separators", () => {
    // Git for Windows and node's path APIs both emit these; neither separator can be assumed.
    expect(pathLeaf("C:\\repos\\semantic_viz/packages/ui\\src\\App.tsx")).toBe("App.tsx");
  });

  it("ignores trailing separators of either flavour", () => {
    expect(pathLeaf("/home/dev/semantic_viz/")).toBe("semantic_viz");
    expect(pathLeaf("C:\\Users\\dev\\semantic_viz\\")).toBe("semantic_viz");
  });

  it("returns a bare name unchanged", () => {
    expect(pathLeaf("semantic_viz")).toBe("semantic_viz");
  });

  it("trims surrounding whitespace before reading the leaf", () => {
    expect(pathLeaf("  packages/ui/src/App.tsx  ")).toBe("App.tsx");
  });

  it("returns an empty string for input that is only separators", () => {
    // Degenerate, but it must not throw or return a stray separator: the toolbar would
    // render "/" as the project name.
    expect(pathLeaf("///")).toBe("");
    expect(pathLeaf("")).toBe("");
  });
});

describe("displayName", () => {
  it("shortens a posix module path to its file name", () => {
    expect(displayName(makeUnit({ id: "m1", name: "packages/ui/src/App.tsx" }))).toBe("App.tsx");
  });

  it("shortens a windows module path to its file name", () => {
    expect(displayName(makeUnit({ id: "m1", name: "packages\\ui\\src\\App.tsx" }))).toBe("App.tsx");
  });

  it("leaves a non-module name alone even when it looks like a path", () => {
    // Only modules are named by path; a symbol that happens to contain a separator
    // (a nested class, a qualified name) must survive intact.
    const unit = makeUnit({ id: "c1", kind: "class", name: "Outer\\Inner" });
    expect(displayName(unit)).toBe("Outer\\Inner");
  });
});

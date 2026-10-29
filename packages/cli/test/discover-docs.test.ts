import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverDocs } from "../src/discover-docs.js";

describe("discoverDocs", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "scv-discover-docs-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("finds a root-level README.md", () => {
    writeFileSync(path.join(root, "README.md"), "# Project\n\nSome real content here.");

    const docs = discoverDocs(root);

    expect(docs.map((d) => d.path)).toContain("README.md");
  });

  it("finds .rst files at root and .md/.rst files recursively under docs/", () => {
    writeFileSync(path.join(root, "OVERVIEW.rst"), "Overview\n========\n\nSome real content.");
    mkdirSync(path.join(root, "docs", "adr"), { recursive: true });
    writeFileSync(path.join(root, "docs", "design.md"), "# Design\n\nSome real content here.");
    writeFileSync(path.join(root, "docs", "adr", "0001-choice.md"), "# ADR 1\n\nSome real content here.");

    const docs = discoverDocs(root);
    const paths = docs.map((d) => d.path).sort();

    expect(paths).toEqual(["OVERVIEW.rst", "docs/adr/0001-choice.md", "docs/design.md"]);
  });

  it("matches a top-level documentation/ directory case-insensitively", () => {
    mkdirSync(path.join(root, "Documentation"), { recursive: true });
    writeFileSync(path.join(root, "Documentation", "guide.md"), "# Guide\n\nSome real content here.");

    const docs = discoverDocs(root);

    expect(docs.map((d) => d.path)).toContain("Documentation/guide.md");
  });

  it("does not recurse into a non-root-level docs/ directory", () => {
    mkdirSync(path.join(root, "src", "docs"), { recursive: true });
    writeFileSync(path.join(root, "src", "docs", "notes.md"), "# Notes\n\nSome real content here.");

    const docs = discoverDocs(root);

    expect(docs.map((d) => d.path)).not.toContain("src/docs/notes.md");
  });

  it("skips node_modules, .git, and .scv", () => {
    mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
    writeFileSync(path.join(root, "node_modules", "pkg", "README.md"), "# Should be skipped\n\nContent.");
    mkdirSync(path.join(root, ".git"), { recursive: true });
    writeFileSync(path.join(root, ".git", "COMMIT_EDITMSG.md"), "# Should be skipped\n\nContent.");
    mkdirSync(path.join(root, ".scv"), { recursive: true });
    writeFileSync(path.join(root, ".scv", "notes.md"), "# Should be skipped\n\nContent.");
    mkdirSync(path.join(root, "docs"), { recursive: true });
    writeFileSync(path.join(root, "docs", "keep.md"), "# Keep\n\nReal content here.");

    const docs = discoverDocs(root);

    expect(docs.map((d) => d.path)).toEqual(["docs/keep.md"]);
  });

  it("skips empty/near-empty files", () => {
    writeFileSync(path.join(root, "TINY.md"), "hi");
    writeFileSync(path.join(root, "REAL.md"), "This has enough content to be worth an LLM call, surely.");

    const docs = discoverDocs(root);
    const paths = docs.map((d) => d.path);

    expect(paths).not.toContain("TINY.md");
    expect(paths).toContain("REAL.md");
  });

  it("returns full, untruncated file content", () => {
    const long = "word ".repeat(5000);
    writeFileSync(path.join(root, "README.md"), long);

    const docs = discoverDocs(root);

    expect(docs.find((d) => d.path === "README.md")?.content).toBe(long);
  });

  it("ignores files that are neither .md nor .rst", () => {
    writeFileSync(path.join(root, "LICENSE"), "MIT License, plenty of legal text here.");
    writeFileSync(path.join(root, "notes.txt"), "Some plain text notes, plenty of content here.");

    const docs = discoverDocs(root);

    expect(docs).toEqual([]);
  });
});

describe("discoverDocs in a git repo", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "scv-discover-docs-git-"));
    spawnSync("git", ["init", "-q"], { cwd: root });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("skips docs git ignores, which a fresh clone would not have", () => {
    mkdirSync(path.join(root, "docs", "private"), { recursive: true });
    writeFileSync(path.join(root, "README.md"), "# Project\n\nSome real content here.");
    writeFileSync(path.join(root, "NOTES.md"), "# Notes\n\nSome real local-only content.");
    writeFileSync(path.join(root, "docs", "design.md"), "# Design\n\nSome real content here.");
    writeFileSync(path.join(root, "docs", "private", "draft.md"), "# Draft\n\nSome real local-only content.");
    writeFileSync(path.join(root, ".gitignore"), "NOTES.md\ndocs/private/\n");

    expect(discoverDocs(root).map((d) => d.path).sort()).toEqual(["README.md", "docs/design.md"]);
  });
});

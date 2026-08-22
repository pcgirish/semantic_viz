import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ANCESTOR_WALK_LIMIT, ancestorShas, headRev } from "../src/rev.js";

const orderlyRoot = fileURLToPath(new URL("../../../fixtures/orderly", import.meta.url));

describe("headRev", () => {
  it("reads sha, author, and timestamp from git", () => {
    const rev = headRev(orderlyRoot);
    expect(rev.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(rev.kind).toBe("commit");
    expect(rev.author).not.toBe("");
    expect(rev.ts).not.toBe("");
  });
});

describe("ancestorShas", () => {
  it("returns first-parent ancestors of HEAD, nearest first, excluding HEAD itself", () => {
    const head = headRev(orderlyRoot).sha;
    const ancestors = ancestorShas(orderlyRoot);
    expect(ancestors).not.toContain(head);
    for (const sha of ancestors) expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(new Set(ancestors).size).toBe(ancestors.length);
  });

  it("bounds the walk so a deep history cannot make analyze walk the whole repo", () => {
    expect(ancestorShas(orderlyRoot).length).toBeLessThanOrEqual(ANCESTOR_WALK_LIMIT);
  });

  it("degrades to an empty list rather than throwing outside a git repository", () => {
    expect(ancestorShas(mkdtempSync(path.join(tmpdir(), "scv-rev-")))).toEqual([]);
  });
});

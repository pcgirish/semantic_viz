import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { headRev } from "../src/rev.js";

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

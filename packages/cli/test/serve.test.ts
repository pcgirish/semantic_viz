import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { runServe } from "../src/serve.js";

function writeScvFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "scv-cli-serve-test-"));
  const scvDir = path.join(root, ".scv");
  const snapshotsDir = path.join(scvDir, "snapshots");
  mkdirSync(snapshotsDir, { recursive: true });
  const sha = "a".repeat(40);
  writeFileSync(
    path.join(snapshotsDir, `${sha}.json`),
    JSON.stringify({
      schema: "scv/1",
      snapshot_id: "snap-1",
      repo: { root: "orderly", vcs: "git" },
      rev: { sha, kind: "commit", ts: "2026-01-01T00:00:00Z", author: "Ada", author_kind: "human" },
      provenance: { extractor: "scv-ts/0.1.0", interpreter: { model: "none", prompt_rev: "none" } },
      units: [],
      edges: [],
      externals: [],
    }),
  );
  return root;
}

describe("runServe", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("starts a listening server that serves the given repo's .scv API", async () => {
    const root = writeScvFixture();
    const { app: started, port } = await runServe({ root, port: 0 });
    app = started;

    const res = await fetch(`http://127.0.0.1:${port}/api/revs`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(1);
  });
});

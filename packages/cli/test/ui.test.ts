import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { runUi } from "../src/ui.js";

function writeDistFixture(): string {
  const dist = mkdtempSync(path.join(tmpdir(), "scv-cli-ui-test-"));
  writeFileSync(path.join(dist, "index.html"), "<html><body>scv ui</body></html>");
  mkdirSync(path.join(dist, "assets"), { recursive: true });
  writeFileSync(path.join(dist, "assets", "app.js"), "console.log('scv');");
  return dist;
}

describe("runUi", () => {
  let app: FastifyInstance | undefined;
  let upstream: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    await upstream?.close();
    app = undefined;
    upstream = undefined;
  });

  it("serves index.html at /", async () => {
    const distDir = writeDistFixture();
    const { app: started, port } = await runUi({ port: 0, apiPort: 3000, distDir });
    app = started;

    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("scv ui");
  });

  it("serves a static asset from dist/", async () => {
    const distDir = writeDistFixture();
    const { app: started, port } = await runUi({ port: 0, apiPort: 3000, distDir });
    app = started;

    const res = await fetch(`http://127.0.0.1:${port}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("console.log");
  });

  it("proxies /api/* to the configured api port", async () => {
    upstream = Fastify();
    upstream.get("/api/revs", async () => [{ sha: "stub" }]);
    await upstream.listen({ port: 0, host: "127.0.0.1" });
    const apiPort = (upstream.server.address() as { port: number }).port;

    const distDir = writeDistFixture();
    const { app: started, port } = await runUi({ port: 0, apiPort, distDir });
    app = started;

    const res = await fetch(`http://127.0.0.1:${port}/api/revs`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ sha: "stub" }]);
  });

  it("rejects clearly when the dist directory is missing", async () => {
    const missingDir = path.join(tmpdir(), "scv-cli-ui-test-missing-" + Date.now());
    await expect(runUi({ port: 0, apiPort: 3000, distDir: missingDir })).rejects.toThrow(
      /npm run build --workspace packages\/ui/,
    );
  });
});

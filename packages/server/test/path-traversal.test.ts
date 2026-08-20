import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { connect } from "node:net";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { makeSnapshot, writeScvFixture } from "./fixtures.js";

const SHA = "a".repeat(40);

/**
 * Plants a file outside the .scv directory that a traversal would reach, and returns both
 * paths. The server must never serve `secretFile` regardless of how the request encodes `..`.
 */
function fixtureWithOutsideSecret(): { scvDir: string } {
  const scvDir = writeScvFixture([makeSnapshot()]);
  // A sibling of `<scvDir>/layouts`, so a single `..` in the sha param reaches it. Named to
  // match the `${sha}.${skin}.json` pattern the route builds, which is what makes it servable.
  writeFileSync(path.join(scvDir, "leak.tiles.json"), JSON.stringify({ nodeX: { SECRETVALUE: 1 } }));
  return { scvDir };
}

/**
 * Sends a request line verbatim over a raw socket. `app.inject` and every normalizing HTTP
 * client rewrite percent-encoded segments before routing, which is exactly what hides this
 * class of bug — the encoded traversal has to reach Fastify's router untouched to be tested.
 */
async function rawGet(app: ReturnType<typeof buildApp>, target: string): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (typeof address === "string" || address === null) throw new Error("no TCP address");
  try {
    return await new Promise<string>((resolve, reject) => {
      const socket = connect(address.port, "127.0.0.1", () => {
        socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
      });
      let body = "";
      socket.on("data", (chunk) => { body += chunk.toString(); });
      socket.on("end", () => resolve(body));
      socket.on("error", reject);
    });
  } finally {
    await app.close();
  }
}

describe("GET /api/layout path traversal", () => {
  // Both encodings were confirmed to return 200 with the planted file's contents before the fix;
  // Fastify strips a literal `../` but passes these through to the route handler intact.
  it.each([
    ["percent-encoded", "..%2Fleak"],
    ["fully percent-encoded", "%2e%2e%2fleak"],
  ])("rejects a %s traversal sent over a raw socket instead of serving the file", async (_label, sha) => {
    const { scvDir } = fixtureWithOutsideSecret();
    const app = buildApp({ scvDir });

    const response = await rawGet(app, `/api/layout/${sha}/tiles`);

    expect(response).not.toContain("SECRETVALUE");
    expect(response.split("\r\n")[0]).toContain("400");
  });

  it("rejects a literal ../ traversal in the sha param", async () => {
    const { scvDir } = fixtureWithOutsideSecret();
    const app = buildApp({ scvDir });

    const res = await app.inject({ method: "GET", url: "/api/layout/..%2F..%2Foutside%2Fleak/tiles" });

    expect(res.statusCode).toBe(400);
  });

  it("rejects an absolute path in the sha param", async () => {
    const { scvDir } = fixtureWithOutsideSecret();
    const app = buildApp({ scvDir });

    const res = await app.inject({ method: "GET", url: `/api/layout/${encodeURIComponent("/etc/passwd")}/tiles` });

    expect(res.statusCode).toBe(400);
  });

  it("rejects an unknown skin rather than joining it into a path", async () => {
    const { scvDir } = fixtureWithOutsideSecret();
    const app = buildApp({ scvDir });

    const res = await app.inject({ method: "GET", url: `/api/layout/${SHA}/${encodeURIComponent("../../evil")}` });

    expect(res.statusCode).toBe(400);
  });
});

describe("PUT /api/layout validation", () => {
  it("rejects a traversal in the sha param without writing anything to disk", async () => {
    const { scvDir } = fixtureWithOutsideSecret();
    const app = buildApp({ scvDir });
    const outsideTarget = path.join(scvDir, "..", "pwned");

    const res = await app.inject({
      method: "PUT",
      url: "/api/layout/..%2F..%2Fpwned/tiles",
      payload: { nodeX: { a: 1 } },
    });

    expect(res.statusCode).toBe(400);
    expect(existsSync(`${outsideTarget}.tiles.json`)).toBe(false);
  });

  it("rejects a body that is not a valid layout", async () => {
    const { scvDir } = fixtureWithOutsideSecret();
    const app = buildApp({ scvDir });

    const res = await app.inject({
      method: "PUT",
      url: `/api/layout/${SHA}/tiles`,
      payload: { nodeX: { a: "not-a-number" } },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects non-finite coordinates, which would corrupt the persisted layout as null", async () => {
    const { scvDir } = fixtureWithOutsideSecret();
    const app = buildApp({ scvDir });

    // Sent as a raw body: an over-range JSON number is what a client actually puts on the
    // wire, and `JSON.parse` turns it into `Infinity` — which re-serializes back out as `null`.
    const res = await app.inject({
      method: "PUT",
      url: `/api/layout/${SHA}/tiles`,
      headers: { "content-type": "application/json" },
      payload: '{"nodeX":{"a":1e400}}',
    });

    expect(res.statusCode).toBe(400);
  });

  it("still round-trips a valid layout", async () => {
    const snapshot = makeSnapshot();
    const scvDir = writeScvFixture([snapshot]);
    const app = buildApp({ scvDir });
    const layout = { nodeX: { "unit:orders": 0, "unit:billing": 120 } };

    const put = await app.inject({ method: "PUT", url: `/api/layout/${snapshot.rev.sha}/tiles`, payload: layout });
    expect(put.statusCode).toBe(204);

    const get = await app.inject({ method: "GET", url: `/api/layout/${snapshot.rev.sha}/tiles` });
    expect(get.json()).toEqual(layout);
  });
});

describe("param validation on snapshot and delta routes", () => {
  it("rejects a traversal in the snapshot sha rather than treating it as a miss", async () => {
    const { scvDir } = fixtureWithOutsideSecret();
    const app = buildApp({ scvDir });

    const res = await app.inject({ method: "GET", url: "/api/snapshot/..%2F..%2Fetc%2Fpasswd" });

    expect(res.statusCode).toBe(400);
  });

  it("rejects a traversal in the delta params", async () => {
    const { scvDir } = fixtureWithOutsideSecret();
    const app = buildApp({ scvDir });

    const res = await app.inject({ method: "GET", url: `/api/delta/..%2F..%2Fevil/${SHA}` });

    expect(res.statusCode).toBe(400);
  });
});

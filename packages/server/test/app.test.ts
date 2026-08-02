import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { makeDelta, makeSnapshot, writeScvFixture } from "./fixtures.js";

describe("server routes", () => {
  it("GET /api/revs returns the rev list", async () => {
    const snapshot = makeSnapshot();
    const scvDir = writeScvFixture([snapshot]);
    const app = buildApp({ scvDir });

    const res = await app.inject({ method: "GET", url: "/api/revs" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        sha: snapshot.rev.sha,
        kind: "commit",
        ts: snapshot.rev.ts,
        author: snapshot.rev.author,
        author_kind: snapshot.rev.author_kind,
        amount: 0,
      },
    ]);
  });

  it("GET /api/revs reports each rev's amount from its delta against the previous rev", async () => {
    const s1 = makeSnapshot({
      rev: { sha: "a".repeat(40), kind: "commit", ts: "2026-01-01T00:00:00Z", author: "Ada", author_kind: "human" },
    });
    const s2 = makeSnapshot({
      rev: { sha: "b".repeat(40), kind: "commit", ts: "2026-01-02T00:00:00Z", author: "Ada", author_kind: "human" },
    });
    const delta = makeDelta({
      from: { snapshot_id: "snap-1", sha: "a".repeat(40) },
      to: { snapshot_id: "snap-2", sha: "b".repeat(40) },
      unit_deltas: [
        {
          unit: "unit:billing",
          qualname: "billing",
          kind: "module",
          status: "modified",
          fields: ["semantics"],
          amount: 0.4,
          blast_radius: { direct: 1, transitive: 1, public_api: false },
          authors: [],
          risk: { score: 0.6, axes: null, why: null, confidence: 0.8, source: "formula" },
        },
        {
          unit: "unit:orders",
          qualname: "orders",
          kind: "module",
          status: "modified",
          fields: ["semantics"],
          amount: 0.2,
          blast_radius: { direct: 1, transitive: 1, public_api: false },
          authors: [],
          risk: { score: 0.3, axes: null, why: null, confidence: 0.8, source: "formula" },
        },
      ],
    });
    const scvDir = writeScvFixture([s1, s2], [delta]);
    const app = buildApp({ scvDir });

    const res = await app.inject({ method: "GET", url: "/api/revs" });

    const body = res.json() as Array<{ sha: string; amount: number }>;
    expect(body.find((r) => r.sha === s2.rev.sha)?.amount).toBeCloseTo(0.3);
    expect(body.find((r) => r.sha === s1.rev.sha)?.amount).toBe(0);
  });

  it("GET /api/snapshot/:sha returns the full snapshot", async () => {
    const snapshot = makeSnapshot();
    const scvDir = writeScvFixture([snapshot]);
    const app = buildApp({ scvDir });

    const res = await app.inject({ method: "GET", url: `/api/snapshot/${snapshot.rev.sha}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(snapshot);
  });

  it("GET /api/snapshot/:sha 404s on an unknown sha", async () => {
    const scvDir = writeScvFixture([makeSnapshot()]);
    const app = buildApp({ scvDir });

    const res = await app.inject({ method: "GET", url: `/api/snapshot/${"f".repeat(40)}` });

    expect(res.statusCode).toBe(404);
  });

  it("GET /api/snapshot/:sha/unit/:id returns the unit with neighbours", async () => {
    const snapshot = makeSnapshot();
    const scvDir = writeScvFixture([snapshot]);
    const app = buildApp({ scvDir });

    const res = await app.inject({ method: "GET", url: `/api/snapshot/${snapshot.rev.sha}/unit/unit:orders` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ unit: snapshot.units[0], neighbours: [snapshot.units[1]] });
  });

  it("GET /api/snapshot/:sha/unit/:id 404s on an unknown unit", async () => {
    const snapshot = makeSnapshot();
    const scvDir = writeScvFixture([snapshot]);
    const app = buildApp({ scvDir });

    const res = await app.inject({ method: "GET", url: `/api/snapshot/${snapshot.rev.sha}/unit/unit:missing` });

    expect(res.statusCode).toBe(404);
  });

  it("GET /api/search?q= returns matching units from the latest snapshot", async () => {
    const snapshot = makeSnapshot();
    const scvDir = writeScvFixture([snapshot]);
    const app = buildApp({ scvDir });

    const res = await app.inject({ method: "GET", url: "/api/search?q=bill" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([snapshot.units[1]]);
  });

  it("GET /api/search without q returns 400", async () => {
    const scvDir = writeScvFixture([makeSnapshot()]);
    const app = buildApp({ scvDir });

    const res = await app.inject({ method: "GET", url: "/api/search" });

    expect(res.statusCode).toBe(400);
  });

  it("GET /api/delta/:from/:to returns the delta between two snapshots", async () => {
    const delta = makeDelta();
    const scvDir = writeScvFixture([], [delta]);
    const app = buildApp({ scvDir });

    const res = await app.inject({ method: "GET", url: `/api/delta/${delta.from.sha}/${delta.to.sha}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(delta);
  });

  it("GET /api/delta/:from/:to 404s when no delta file exists for that pair", async () => {
    const scvDir = writeScvFixture([], []);
    const app = buildApp({ scvDir });

    const res = await app.inject({ method: "GET", url: `/api/delta/${"a".repeat(40)}/${"b".repeat(40)}` });

    expect(res.statusCode).toBe(404);
  });
});

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
    expect(res.json()).toEqual([{ sha: snapshot.rev.sha, kind: "commit", ts: snapshot.rev.ts, author: snapshot.rev.author }]);
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

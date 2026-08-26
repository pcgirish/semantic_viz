import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { Unit } from "@scv/schema";
import { ContentCache } from "../src/cache.js";

/** Minimal schema-valid Unit, the shape `pass_a_units.result_json` must round-trip. */
function unitFixture(id: string, overrides: Partial<Unit> = {}): Unit {
  return {
    id,
    kind: "function",
    name: "run",
    qualname: "mod.run",
    lang: "python",
    parent: null,
    children: [],
    loc: { files: ["mod.py"], start: 1, end: 10, sloc: 10 },
    signature: null,
    semantics: {
      what: "does a thing",
      how: "by doing it",
      when: "on request",
      where: "mod.py",
      why: "because",
      confidence: 0.9,
      source: "llm",
    },
    cost: null,
    tags: [],
    metrics: {},
    authors: undefined,
    hash: { struct: "s1", text: "t1", semantic: "sem1" },
    provenance: { source: "llm", pass: "A", provider: "ollama", model: "m" },
    ...overrides,
  } as Unit;
}

describe("ContentCache pass_a_units store", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "scv-pass-a-units-"));
    dbPath = path.join(dir, "cache.sqlite");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const key = { sha: "sha1", promptRev: "p1", provider: "ollama", model: "m" };

  // Test 14 — store round-trip.
  it("returns a stored record with its status", () => {
    const cache = new ContentCache(dbPath);
    const unit = unitFixture("u:a");
    cache.setPassAUnit(key, { unitId: "u:a", structHash: "s1", unit, status: "ok" });

    const got = cache.getPassAUnits(key, new Map([["u:a", "s1"]]));
    expect(got.get("u:a")).toEqual({ unit, status: "ok" });
    cache.close();
  });

  it("round-trips a failed record", () => {
    const cache = new ContentCache(dbPath);
    const unit = unitFixture("u:a", { semantics: null });
    cache.setPassAUnit(key, { unitId: "u:a", structHash: "s1", unit, status: "failed" });

    expect(cache.getPassAUnits(key, new Map([["u:a", "s1"]])).get("u:a")?.status).toBe("failed");
    cache.close();
  });

  it("does not return a row written under a different struct_hash, promptRev, provider, or model", () => {
    const cache = new ContentCache(dbPath);
    cache.setPassAUnit(key, { unitId: "u:a", structHash: "s1", unit: unitFixture("u:a"), status: "ok" });

    expect(cache.getPassAUnits(key, new Map([["u:a", "s2"]])).has("u:a")).toBe(false);
    expect(cache.getPassAUnits({ ...key, promptRev: "p2" }, new Map([["u:a", "s1"]])).has("u:a")).toBe(false);
    expect(cache.getPassAUnits({ ...key, provider: "anthropic" }, new Map([["u:a", "s1"]])).has("u:a")).toBe(false);
    expect(cache.getPassAUnits({ ...key, model: "other" }, new Map([["u:a", "s1"]])).has("u:a")).toBe(false);
    expect(cache.getPassAUnits({ ...key, sha: "sha2" }, new Map([["u:a", "s1"]])).has("u:a")).toBe(false);
    cache.close();
  });

  it("returns only the current-hash row when a stale row for the same unit also exists", () => {
    const cache = new ContentCache(dbPath);
    const stale = unitFixture("u:a", { name: "stale" });
    const current = unitFixture("u:a", { name: "current" });
    cache.setPassAUnit(key, { unitId: "u:a", structHash: "old", unit: stale, status: "ok" });
    cache.setPassAUnit(key, { unitId: "u:a", structHash: "new", unit: current, status: "ok" });

    const got = cache.getPassAUnits(key, new Map([["u:a", "new"]]));
    expect(got.size).toBe(1);
    expect(got.get("u:a")?.unit.name).toBe("current");
    cache.close();
  });

  it("upserts rather than duplicating when the same unit is written twice", () => {
    const cache = new ContentCache(dbPath);
    cache.setPassAUnit(key, { unitId: "u:a", structHash: "s1", unit: unitFixture("u:a", { name: "first" }), status: "failed" });
    cache.setPassAUnit(key, { unitId: "u:a", structHash: "s1", unit: unitFixture("u:a", { name: "second" }), status: "ok" });

    const got = cache.getPassAUnits(key, new Map([["u:a", "s1"]]));
    expect(got.size).toBe(1);
    expect(got.get("u:a")).toMatchObject({ status: "ok" });
    expect(got.get("u:a")?.unit.name).toBe("second");
    cache.close();
  });

  it("handles a lookup spanning more units than one SQL parameter chunk", () => {
    const cache = new ContentCache(dbPath);
    const hashes = new Map<string, string>();
    for (let i = 0; i < 500; i++) {
      const id = `u:${i}`;
      hashes.set(id, `s${i}`);
      cache.setPassAUnit(key, { unitId: id, structHash: `s${i}`, unit: unitFixture(id), status: "ok" });
    }

    expect(cache.getPassAUnits(key, hashes).size).toBe(500);
    cache.close();
  });

  // Test 9 — corrupt rows are dropped, not thrown on.
  it("drops and deletes a row whose result_json is truncated or fails the Unit schema", () => {
    const cache = new ContentCache(dbPath);
    cache.setPassAUnit(key, { unitId: "u:good", structHash: "s1", unit: unitFixture("u:good"), status: "ok" });
    cache.close();

    const db = new Database(dbPath);
    const insert = db.prepare(
      `INSERT INTO pass_a_units (sha, unit_id, struct_hash, prompt_rev, provider, model, result_json, status, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ok', '2026-01-01')`,
    );
    insert.run(key.sha, "u:truncated", "s1", key.promptRev, key.provider, key.model, '{"id":"u:trunc');
    insert.run(key.sha, "u:badschema", "s1", key.promptRev, key.provider, key.model, '{"id":"u:badschema"}');
    db.close();

    const reopened = new ContentCache(dbPath);
    const hashes = new Map([
      ["u:good", "s1"],
      ["u:truncated", "s1"],
      ["u:badschema", "s1"],
    ]);
    const got = reopened.getPassAUnits(key, hashes);
    expect(got.has("u:truncated")).toBe(false);
    expect(got.has("u:badschema")).toBe(false);
    expect(got.has("u:good")).toBe(true);
    reopened.close();

    const check = new Database(dbPath);
    const remaining = check
      .prepare("SELECT unit_id FROM pass_a_units ORDER BY unit_id")
      .all() as { unit_id: string }[];
    expect(remaining.map((r) => r.unit_id)).toEqual(["u:good"]);
    check.close();
  });
});

describe("ContentCache poisoned-row cleanup", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "scv-cleanup-"));
    dbPath = path.join(dir, "cache.sqlite");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Test 15 — the sweep runs once, guarded by a durable marker.
  it("deletes unparseable cache rows on first open and does not re-sweep on the next", () => {
    // Seeded through raw SQLite so the marker is not yet set — this is the shape of a cache
    // written by a binary that predates the cleanup, which is exactly what the sweep exists for.
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE cache (
        input_hash TEXT NOT NULL, prompt_rev TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
        text TEXT NOT NULL, tokens INTEGER NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
        PRIMARY KEY (input_hash, prompt_rev, provider, model)
      )
    `);
    db.prepare(
      `INSERT INTO cache (input_hash, prompt_rev, provider, model, text, tokens)
       VALUES ('good','p1','ollama','m','{"what":"ok"}',3), ('bad','p1','ollama','m','{not json',1)`,
    ).run();
    db.close();

    const first = new ContentCache(dbPath);
    expect(first.get({ inputHash: "bad", promptRev: "p1", provider: "ollama", model: "m" })).toBeUndefined();
    expect(first.get({ inputHash: "good", promptRev: "p1", provider: "ollama", model: "m" })).toBeDefined();
    first.close();

    // Marker is set, so a second open must not sweep again — re-insert a bad row and assert it survives.
    const db2 = new Database(dbPath);
    db2.prepare(
      "INSERT INTO cache (input_hash, prompt_rev, provider, model, text, tokens) VALUES ('bad2','p1','ollama','m','{still not json',1)",
    ).run();
    db2.close();

    const second = new ContentCache(dbPath);
    expect(second.get({ inputHash: "bad2", promptRev: "p1", provider: "ollama", model: "m" })).toBeDefined();
    second.close();
  });
});

describe("ContentCache.delete", () => {
  it("removes a row so a later get misses", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "scv-cache-delete-"));
    const cache = new ContentCache(path.join(dir, "cache.sqlite"));
    const key = { inputHash: "abc", promptRev: "p1", provider: "ollama", model: "m" };
    cache.set(key, { text: "x", tokens: 1 });
    cache.delete(key);
    expect(cache.get(key)).toBeUndefined();
    cache.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

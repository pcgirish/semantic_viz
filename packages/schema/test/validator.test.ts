import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SnapshotSchema, DeltaSchema } from "../src/index.js";
import { snapshotJsonSchema, deltaJsonSchema } from "../src/json-schema.js";

const fixturePath = (name: string) =>
  fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

const loadFixture = (name: string) =>
  JSON.parse(readFileSync(fixturePath(name), "utf-8"));

describe("orderly fixture validates against scv/1", () => {
  it("accepts the base snapshot", () => {
    const result = SnapshotSchema.safeParse(loadFixture("orderly.snapshot.base.json"));
    expect(result.success).toBe(true);
  });

  it("accepts the head snapshot", () => {
    const result = SnapshotSchema.safeParse(loadFixture("orderly.snapshot.head.json"));
    expect(result.success).toBe(true);
  });

  it("accepts the delta document", () => {
    const result = DeltaSchema.safeParse(loadFixture("orderly.delta.json"));
    expect(result.success).toBe(true);
  });

  it("rejects a snapshot with the wrong schema tag", () => {
    const snapshot = loadFixture("orderly.snapshot.base.json");
    const result = SnapshotSchema.safeParse({ ...snapshot, schema: "scv/2" });
    expect(result.success).toBe(false);
  });

  it("rejects a unit missing a required field", () => {
    const snapshot = loadFixture("orderly.snapshot.base.json");
    const [firstUnit, ...restUnits] = snapshot.units;
    const unitWithoutId = { ...firstUnit };
    delete unitWithoutId.id;
    const result = SnapshotSchema.safeParse({
      ...snapshot,
      units: [unitWithoutId, ...restUnits],
    });
    expect(result.success).toBe(false);
  });

  it("parses a fixture snapshot whose units have no group field, without throwing", () => {
    const snapshot = loadFixture("orderly.snapshot.base.json");
    expect(snapshot.units.some((u: { group?: string }) => "group" in u)).toBe(false);
    const result = SnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(true);
  });

  it("accepts a layer unit with a group field set", () => {
    const snapshot = loadFixture("orderly.snapshot.base.json");
    const [firstUnit, ...restUnits] = snapshot.units;
    const unitWithGroup = { ...firstUnit, group: "api surface" };
    const result = SnapshotSchema.safeParse({
      ...snapshot,
      units: [unitWithGroup, ...restUnits],
    });
    expect(result.success).toBe(true);
  });
});

describe("JSON Schema emit", () => {
  it("generates a JSON Schema for the snapshot contract", () => {
    expect(snapshotJsonSchema.$schema).toBeDefined();
    expect(snapshotJsonSchema.definitions).toHaveProperty("scv/1");
  });

  it("generates a JSON Schema for the delta contract", () => {
    expect(deltaJsonSchema.$schema).toBeDefined();
    expect(deltaJsonSchema.definitions).toHaveProperty("scv-delta/1");
  });
});

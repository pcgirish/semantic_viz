import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SnapshotSchema, DeltaSchema, UnitSchema } from "../src/index.js";
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

  it("accepts a group unit, the tier that replaced the layer `group` string", () => {
    const snapshot = loadFixture("orderly.snapshot.base.json");
    const [firstUnit, ...restUnits] = snapshot.units;
    const groupUnit = { ...firstUnit, id: "u:group:g1", kind: "group", name: "api surface" };
    const result = SnapshotSchema.safeParse({
      ...snapshot,
      units: [groupUnit, ...restUnits],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a block unit", () => {
    const snapshot = loadFixture("orderly.snapshot.base.json");
    const [firstUnit, ...restUnits] = snapshot.units;
    const blockUnit = {
      ...firstUnit,
      id: "u:block:abc123",
      kind: "block",
      name: "x > 0",
      qualname: "u:block:abc123",
      parent: firstUnit.id,
      children: [],
      semantics: null,
      signature: null,
    };
    const result = SnapshotSchema.safeParse({
      ...snapshot,
      units: [blockUnit, ...restUnits],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a control_flow edge with a flowType", () => {
    const snapshot = loadFixture("orderly.snapshot.base.json");
    const [firstEdge, ...restEdges] = snapshot.edges;
    const cfEdge = { ...firstEdge, kind: "control_flow", flowType: "true" };
    const result = SnapshotSchema.safeParse({
      ...snapshot,
      edges: [cfEdge, ...restEdges],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a control_flow edge with an invalid flowType", () => {
    const snapshot = loadFixture("orderly.snapshot.base.json");
    const [firstEdge, ...restEdges] = snapshot.edges;
    const cfEdge = { ...firstEdge, kind: "control_flow", flowType: "maybe" };
    const result = SnapshotSchema.safeParse({
      ...snapshot,
      edges: [cfEdge, ...restEdges],
    });
    expect(result.success).toBe(false);
  });
});

describe("Unit provenance backward compatibility and new source values", () => {
  it("parses a unit with pre-existing provenance lacking provider/model fields", () => {
    const snapshot = loadFixture("orderly.snapshot.base.json");
    const [firstUnit] = snapshot.units;
    const oldProvenance = { ...firstUnit, provenance: { source: "llm", pass: "A" } };
    const result = UnitSchema.safeParse(oldProvenance);
    expect(result.success).toBe(true);
  });

  it("parses a unit with cost.source === 'manual'", () => {
    const snapshot = loadFixture("orderly.snapshot.base.json");
    const [firstUnit] = snapshot.units;
    const unitWithManualCost = {
      ...firstUnit,
      cost: { complexity: 1, io: [], estimate: "O(1)", confidence: 0.9, source: "manual" as const },
    };
    const result = UnitSchema.safeParse(unitWithManualCost);
    expect(result.success).toBe(true);
  });

  it("parses a unit with provenance.source === 'manual'", () => {
    const snapshot = loadFixture("orderly.snapshot.base.json");
    const [firstUnit] = snapshot.units;
    const unitWithManual = {
      ...firstUnit,
      provenance: { source: "manual", pass: "A" },
      semantics: firstUnit.semantics ? { ...firstUnit.semantics, source: "manual" } : null,
    };
    const result = UnitSchema.safeParse(unitWithManual);
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

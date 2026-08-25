import { describe, expect, it } from "vitest";
import type { Unit } from "@scv/schema";
import { UNGROUPED_ID, buildGroupUnits, resolveGroupMembership } from "../src/groups.js";
import type { Provider } from "../src/provider.js";

const fakeProvider: Provider = {
  name: "fake",
  model: "fake-model",
  interpret: async () => {
    throw new Error("not implemented in test fixture");
  },
};

function makeLayer(id: string, name: string, overrides: Partial<Unit> = {}): Unit {
  return {
    id,
    kind: "layer",
    name,
    qualname: name,
    parent: null,
    children: [],
    loc: { files: [`${name}.py`], start: null, end: null, sloc: 10 },
    semantics: null,
    cost: null,
    tags: [],
    metrics: { modules: 2, layers: 0 },
    hash: { struct: `s-${id}`, text: null, semantic: null },
    provenance: { source: "llm", pass: "C" },
    ...overrides,
  };
}

describe("resolveGroupMembership", () => {
  it("maps layer names to layer ids", () => {
    const layers = [makeLayer("u:layer:a", "orders"), makeLayer("u:layer:b", "billing")];

    expect(resolveGroupMembership({ Commerce: ["orders", "billing"] }, layers)).toEqual({
      Commerce: ["u:layer:a", "u:layer:b"],
    });
  });

  it("throws on a duplicate layer name, naming the name and the ids sharing it", () => {
    // Nothing enforces layer-name uniqueness — Pass B/C never dedup. Picking a winner is what
    // silently collapsed two layers into one group before this contract existed.
    const layers = [makeLayer("u:layer:a", "core"), makeLayer("u:layer:b", "core")];

    expect(() => resolveGroupMembership({ Commerce: ["core"] }, layers)).toThrow(/core.*u:layer:a.*u:layer:b/s);
  });

  it("throws on a layer name no layer has, naming the group that referenced it", () => {
    const layers = [makeLayer("u:layer:a", "orders")];

    expect(() => resolveGroupMembership({ Commerce: ["orders", "invented"] }, layers)).toThrow(/Commerce.*invented/s);
  });
});

describe("buildGroupUnits", () => {
  const orders = makeLayer("u:layer:a", "orders");
  const billing = makeLayer("u:layer:b", "billing");
  const ops = makeLayer("u:layer:c", "ops");

  it("emits one complete unit per group, parented to the system", () => {
    const { groupUnits } = buildGroupUnits({
      layerUnits: [orders, billing],
      groups: { Commerce: ["u:layer:a", "u:layer:b"] },
      systemId: "u:sys:x", provider: fakeProvider,
    });

    expect(groupUnits).toHaveLength(1);
    const [group] = groupUnits;
    expect(group?.kind).toBe("group");
    expect(group?.name).toBe("Commerce");
    expect(group?.parent).toBe("u:sys:x");
    expect(group?.children).toEqual(["u:layer:a", "u:layer:b"]);
    expect(group?.semantics).toBeNull();
  });

  it("reports how each layer reparents onto its group", () => {
    const { groupUnits, layerParent } = buildGroupUnits({
      layerUnits: [orders, billing],
      groups: { Commerce: ["u:layer:a"], Ops: ["u:layer:b"] },
      systemId: "u:sys:x", provider: fakeProvider,
    });

    const idByName = new Map(groupUnits.map((g) => [g.name, g.id]));
    expect([...layerParent.keys()].sort()).toEqual(["u:layer:a", "u:layer:b"]);
    expect(layerParent.get("u:layer:a")).toBe(idByName.get("Commerce"));
    expect(layerParent.get("u:layer:b")).toBe(idByName.get("Ops"));
  });

  it("derives the id from member ids only, so a rename does not churn identity", () => {
    const named = buildGroupUnits({ layerUnits: [orders], groups: { Commerce: ["u:layer:a"] }, systemId: "u:sys:x", provider: fakeProvider });
    const renamed = buildGroupUnits({ layerUnits: [orders], groups: { Trade: ["u:layer:a"] }, systemId: "u:sys:x", provider: fakeProvider });

    expect(renamed.groupUnits[0]?.id).toBe(named.groupUnits[0]?.id);
    expect(renamed.groupUnits[0]?.hash.struct).toBe(named.groupUnits[0]?.hash.struct);
  });

  it("changes hash.semantic when only the name changes, so a rename reads as modified", () => {
    const named = buildGroupUnits({ layerUnits: [orders], groups: { Commerce: ["u:layer:a"] }, systemId: "u:sys:x", provider: fakeProvider });
    const renamed = buildGroupUnits({ layerUnits: [orders], groups: { Trade: ["u:layer:a"] }, systemId: "u:sys:x", provider: fakeProvider });

    expect(named.groupUnits[0]?.hash.semantic).toBeTruthy();
    expect(renamed.groupUnits[0]?.hash.semantic).not.toBe(named.groupUnits[0]?.hash.semantic);
  });

  it("changes hash.struct when membership changes", () => {
    const one = buildGroupUnits({ layerUnits: [orders, billing], groups: { C: ["u:layer:a"] }, systemId: "u:sys:x", provider: fakeProvider });
    const two = buildGroupUnits({
      layerUnits: [orders, billing],
      groups: { C: ["u:layer:a", "u:layer:b"] },
      systemId: "u:sys:x", provider: fakeProvider,
    });

    expect(two.groupUnits.find((g) => g.name === "C")?.hash.struct).not.toBe(one.groupUnits.find((g) => g.name === "C")?.hash.struct);
  });

  it("is insensitive to member order, so two runs over the same partition agree", () => {
    const forward = buildGroupUnits({
      layerUnits: [orders, billing],
      groups: { C: ["u:layer:a", "u:layer:b"] },
      systemId: "u:sys:x", provider: fakeProvider,
    });
    const reversed = buildGroupUnits({
      layerUnits: [billing, orders],
      groups: { C: ["u:layer:b", "u:layer:a"] },
      systemId: "u:sys:x", provider: fakeProvider,
    });

    expect(reversed.groupUnits[0]?.id).toBe(forward.groupUnits[0]?.id);
    expect(reversed.groupUnits[0]?.children).toEqual(forward.groupUnits[0]?.children);
  });

  it("sums member metrics and unions their files", () => {
    const { groupUnits } = buildGroupUnits({
      layerUnits: [orders, billing],
      groups: { Commerce: ["u:layer:a", "u:layer:b"] },
      systemId: "u:sys:x", provider: fakeProvider,
    });

    expect(groupUnits[0]?.metrics.layers).toBe(2);
    expect(groupUnits[0]?.metrics.modules).toBe(4);
    expect(groupUnits[0]?.loc.sloc).toBe(20);
    expect(groupUnits[0]?.loc.files.sort()).toEqual(["billing.py", "orders.py"]);
  });

  it("collects layers no group claimed into a fixed-identity ungrouped bucket", () => {
    // The one non-fatal gap: "the model grouped 2 of 3 layers" is a legitimate partial result,
    // unlike an invented or ambiguous name, which means the mapping cannot be trusted at all.
    const { groupUnits, layerParent } = buildGroupUnits({
      layerUnits: [orders, billing, ops],
      groups: { Commerce: ["u:layer:a", "u:layer:b"] },
      systemId: "u:sys:x", provider: fakeProvider,
    });

    const bucket = groupUnits.find((g) => g.id === UNGROUPED_ID);
    expect(bucket?.name).toBe("Ungrouped");
    expect(bucket?.children).toEqual(["u:layer:c"]);
    expect(bucket?.provenance.source).toBe("static");
    expect(layerParent.get("u:layer:c")).toBe(UNGROUPED_ID);
  });

  it("omits the ungrouped bucket entirely when every layer is claimed", () => {
    const { groupUnits } = buildGroupUnits({
      layerUnits: [orders, billing],
      groups: { Commerce: ["u:layer:a", "u:layer:b"] },
      systemId: "u:sys:x", provider: fakeProvider,
    });

    expect(groupUnits.find((g) => g.id === UNGROUPED_ID)).toBeUndefined();
  });

  it("throws when a group claims a layer that does not exist", () => {
    expect(() =>
      buildGroupUnits({ layerUnits: [orders], groups: { Commerce: ["u:layer:missing"] }, systemId: "u:sys:x", provider: fakeProvider }),
    ).toThrow(/u:layer:missing/);
  });

  it("throws when a layer is claimed by two groups", () => {
    expect(() =>
      buildGroupUnits({
        layerUnits: [orders],
        groups: { Commerce: ["u:layer:a"], Ops: ["u:layer:a"] },
        systemId: "u:sys:x", provider: fakeProvider,
      }),
    ).toThrow(/u:layer:a/);
  });

  it("throws when a group is empty", () => {
    expect(() =>
      buildGroupUnits({ layerUnits: [orders], groups: { Commerce: ["u:layer:a"], Empty: [] }, systemId: "u:sys:x", provider: fakeProvider }),
    ).toThrow(/Empty/);
  });
});

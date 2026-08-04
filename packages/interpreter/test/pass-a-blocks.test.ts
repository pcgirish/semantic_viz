import { describe, expect, it, vi } from "vitest";
import { runPassABlocks } from "../src/pass-a-blocks.js";
import type { Provider, ProviderResult } from "../src/provider.js";
import type { SymbolBlock } from "@scv/extractor";

function makeBlock(overrides: Partial<SymbolBlock> & { id: string }): SymbolBlock {
  return {
    blockType: "sequential",
    startLine: 1,
    endLine: 1,
    condition: null,
    ...overrides,
  };
}

function fakeProvider(response: object): Provider {
  return {
    name: "fake",
    model: "fake-model",
    interpret: vi.fn(async (): Promise<ProviderResult> => ({ text: JSON.stringify(response), tokens: 10 })),
  };
}

const source = `def create_order(payload):
    if not payload.ok:
        return 400
    order = price_items(payload)
    db.insert(order)
    return 201
`;

describe("runPassABlocks", () => {
  it("returns a label per block id from the provider's response", async () => {
    const blocks = [
      makeBlock({ id: "entry:0", blockType: "entry", startLine: 1, endLine: 1 }),
      makeBlock({ id: "decision:0", blockType: "decision", condition: "not payload.ok", startLine: 2, endLine: 2 }),
      makeBlock({ id: "exit:0", blockType: "exit", startLine: 3, endLine: 3 }),
      makeBlock({ id: "sequential:0", blockType: "sequential", startLine: 4, endLine: 5 }),
      makeBlock({ id: "exit:1", blockType: "exit", startLine: 6, endLine: 6 }),
    ];
    const response = {
      labels: [
        { blockId: "entry:0", label: "entry" },
        { blockId: "decision:0", label: "valid?" },
        { blockId: "exit:0", label: "return 400" },
        { blockId: "sequential:0", label: "price + persist order" },
        { blockId: "exit:1", label: "return 201" },
      ],
    };
    const provider = fakeProvider(response);

    const result = await runPassABlocks({ blocks, source, functionQualname: "src.orders.create_order.create_order", provider, promptRev: "p1" });

    expect(result.get("decision:0")).toBe("valid?");
    expect(result.get("exit:0")).toBe("return 400");
    expect(result.get("sequential:0")).toBe("price + persist order");
  });

  it("passes each block's source span text and id to the provider", async () => {
    const blocks = [makeBlock({ id: "sequential:0", startLine: 4, endLine: 5 })];
    const provider = fakeProvider({ labels: [{ blockId: "sequential:0", label: "persist order" }] });

    await runPassABlocks({ blocks, source, functionQualname: "src.orders.create_order.create_order", provider, promptRev: "p1" });

    const call = (provider.interpret as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("order = price_items(payload)");
    expect(call[0]).toContain("sequential:0");
  });

  it("throws a clear error when the provider returns invalid JSON", async () => {
    const blocks = [makeBlock({ id: "entry:0" })];
    const provider: Provider = {
      name: "fake",
      model: "fake-model",
      interpret: vi.fn(async () => ({ text: "not json", tokens: 1 })),
    };

    await expect(
      runPassABlocks({ blocks, source, functionQualname: "src.orders.create_order.create_order", provider, promptRev: "p1" }),
    ).rejects.toThrow(/pass a.*block/i);
  });

  it("returns an empty map without calling the provider when there are no blocks", async () => {
    const provider = fakeProvider({ labels: [] });

    const result = await runPassABlocks({ blocks: [], source, functionQualname: "src.orders.create_order.create_order", provider, promptRev: "p1" });

    expect(result.size).toBe(0);
    expect(provider.interpret).not.toHaveBeenCalled();
  });

  it("passes callMeta identifying this as a Pass A call for the function", async () => {
    const blocks = [makeBlock({ id: "entry:0" })];
    const provider = fakeProvider({ labels: [{ blockId: "entry:0", label: "entry" }] });

    await runPassABlocks({ blocks, source, functionQualname: "src.orders.create_order.create_order", provider, promptRev: "p1" });

    const call = (provider.interpret as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toMatchObject({ callMeta: { pass: "A", qualname: "src.orders.create_order.create_order" } });
  });
});

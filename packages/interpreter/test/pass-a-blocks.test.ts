import { describe, expect, it, vi } from "vitest";
import { runPassABlocks } from "../src/pass-a-blocks.js";
import type { Provider, ProviderResult } from "../src/provider.js";
import type { SymbolBlock, SymbolControlFlowEdge } from "@scv/extractor";

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

    expect(result.get("decision:0")?.label).toBe("valid?");
    expect(result.get("exit:0")?.label).toBe("return 400");
    expect(result.get("sequential:0")?.label).toBe("price + persist order");
  });

  it("returns per-branch labels for decision/loop blocks, tied to branch semantics not raw true/false", async () => {
    const blocks = [
      makeBlock({ id: "decision:0", blockType: "decision", condition: "not payload.ok", startLine: 2, endLine: 2 }),
    ];
    const response = {
      labels: [
        {
          blockId: "decision:0",
          label: "payload invalid?",
          trueLabel: "invalid",
          falseLabel: "valid",
        },
      ],
    };
    const provider = fakeProvider(response);

    const result = await runPassABlocks({ blocks, source, functionQualname: "src.orders.create_order.create_order", provider, promptRev: "p1" });

    expect(result.get("decision:0")).toEqual({
      label: "payload invalid?",
      trueLabel: "invalid",
      falseLabel: "valid",
    });
  });

  it("omits branch labels for non-branching block types", async () => {
    const blocks = [makeBlock({ id: "sequential:0", startLine: 4, endLine: 5 })];
    const provider = fakeProvider({ labels: [{ blockId: "sequential:0", label: "persist order" }] });

    const result = await runPassABlocks({ blocks, source, functionQualname: "src.orders.create_order.create_order", provider, promptRev: "p1" });

    expect(result.get("sequential:0")).toEqual({ label: "persist order" });
  });

  it("strips trueLabel/falseLabel the provider mistakenly attached to a non-branching block", async () => {
    const blocks = [makeBlock({ id: "exit:0", blockType: "exit", startLine: 3, endLine: 3 })];
    const provider = fakeProvider({
      labels: [{ blockId: "exit:0", label: "check token validity", trueLabel: "invalid token", falseLabel: "valid token" }],
    });

    const result = await runPassABlocks({ blocks, source, functionQualname: "src.auth.verify_token", provider, promptRev: "p1" });

    expect(result.get("exit:0")).toEqual({ label: "check token validity" });
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

  it("retries once, scoped to only the blocks still missing trueLabel/falseLabel", async () => {
    const blocks = [
      makeBlock({ id: "decision:0", blockType: "decision", condition: "not payload.ok", startLine: 2, endLine: 2 }),
      makeBlock({ id: "decision:1", blockType: "decision", condition: "charge.failed", startLine: 3, endLine: 3 }),
    ];
    const firstResponse = {
      labels: [
        { blockId: "decision:0", label: "payload invalid?", trueLabel: "invalid", falseLabel: "valid" },
        { blockId: "decision:1", label: "charge failed?" },
      ],
    };
    const retryResponse = {
      labels: [{ blockId: "decision:1", label: "charge failed?", trueLabel: "failed", falseLabel: "success" }],
    };
    const interpret = vi
      .fn<Provider["interpret"]>()
      .mockResolvedValueOnce({ text: JSON.stringify(firstResponse), tokens: 10 })
      .mockResolvedValueOnce({ text: JSON.stringify(retryResponse), tokens: 10 });
    const provider: Provider = { name: "fake", model: "fake-model", interpret };

    const result = await runPassABlocks({ blocks, source, functionQualname: "src.orders.create_order.create_order", provider, promptRev: "p1" });

    expect(interpret).toHaveBeenCalledTimes(2);
    const retryCall = interpret.mock.calls[1];
    expect(retryCall[0]).toContain("decision:1");
    expect(retryCall[0]).not.toContain("decision:0");
    expect(result.get("decision:0")).toEqual({ label: "payload invalid?", trueLabel: "invalid", falseLabel: "valid" });
    expect(result.get("decision:1")).toEqual({ label: "charge failed?", trueLabel: "failed", falseLabel: "success" });
  });

  it("does not retry when all branching blocks already have trueLabel/falseLabel", async () => {
    const blocks = [makeBlock({ id: "decision:0", blockType: "decision", condition: "not payload.ok", startLine: 2, endLine: 2 })];
    const provider = fakeProvider({
      labels: [{ blockId: "decision:0", label: "payload invalid?", trueLabel: "invalid", falseLabel: "valid" }],
    });

    await runPassABlocks({ blocks, source, functionQualname: "src.orders.create_order.create_order", provider, promptRev: "p1" });

    expect(provider.interpret).toHaveBeenCalledTimes(1);
  });

  it("retries once, scoped to only exit blocks whose reported outcome disagrees with the block graph's raises edges", async () => {
    const blocks = [
      makeBlock({ id: "exit:0", blockType: "exit", startLine: 3, endLine: 3 }),
      makeBlock({ id: "exit:1", blockType: "exit", startLine: 6, endLine: 6 }),
    ];
    const edges: SymbolControlFlowEdge[] = [
      { from: "decision:0", to: "exit:0", edgeType: "true", raises: true },
      { from: "decision:0", to: "exit:1", edgeType: "false" },
    ];
    const firstResponse = {
      labels: [
        { blockId: "exit:0", label: "return 200", outcome: "success" },
        { blockId: "exit:1", label: "return 201", outcome: "success" },
      ],
    };
    const retryResponse = {
      labels: [{ blockId: "exit:0", label: "return 404", outcome: "error" }],
    };
    const interpret = vi
      .fn<Provider["interpret"]>()
      .mockResolvedValueOnce({ text: JSON.stringify(firstResponse), tokens: 10 })
      .mockResolvedValueOnce({ text: JSON.stringify(retryResponse), tokens: 10 });
    const provider: Provider = { name: "fake", model: "fake-model", interpret };

    const result = await runPassABlocks({
      blocks,
      edges,
      source,
      functionQualname: "src.orders.get_order.get_order",
      provider,
      promptRev: "p1",
    });

    expect(interpret).toHaveBeenCalledTimes(2);
    const retryCall = interpret.mock.calls[1];
    expect(retryCall[0]).toContain("exit:0");
    expect(retryCall[0]).not.toContain("exit:1");
    expect(result.get("exit:0")?.label).toBe("return 404");
    expect(result.get("exit:1")?.label).toBe("return 201");
  });

  it("does not retry when every exit block's reported outcome already agrees with raises edges", async () => {
    const blocks = [
      makeBlock({ id: "exit:0", blockType: "exit", startLine: 3, endLine: 3 }),
      makeBlock({ id: "exit:1", blockType: "exit", startLine: 6, endLine: 6 }),
    ];
    const edges: SymbolControlFlowEdge[] = [
      { from: "decision:0", to: "exit:0", edgeType: "true", raises: true },
      { from: "decision:0", to: "exit:1", edgeType: "false" },
    ];
    const provider = fakeProvider({
      labels: [
        { blockId: "exit:0", label: "return 404", outcome: "error" },
        { blockId: "exit:1", label: "return 201", outcome: "success" },
      ],
    });

    await runPassABlocks({
      blocks,
      edges,
      source,
      functionQualname: "src.orders.get_order.get_order",
      provider,
      promptRev: "p1",
    });

    expect(provider.interpret).toHaveBeenCalledTimes(1);
  });

  it("passes callMeta identifying this as a Pass A call for the function", async () => {
    const blocks = [makeBlock({ id: "entry:0" })];
    const provider = fakeProvider({ labels: [{ blockId: "entry:0", label: "entry" }] });

    await runPassABlocks({ blocks, source, functionQualname: "src.orders.create_order.create_order", provider, promptRev: "p1" });

    const call = (provider.interpret as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toMatchObject({ callMeta: { pass: "A", qualname: "src.orders.create_order.create_order" } });
  });
});

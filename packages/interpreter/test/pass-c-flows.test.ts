import { describe, expect, it, vi } from "vitest";
import { proposeFlowEntryPoints, narrateFlow } from "../src/pass-c.js";
import type { Provider, ProviderResult } from "../src/provider.js";
import type { FlowUnitSummary } from "../src/prompts/pass-c-flows.js";

function fakeProvider(responses: object[]): Provider {
  let call = 0;
  return {
    name: "fake",
    model: "fake-model",
    interpret: vi.fn(async (): Promise<ProviderResult> => ({ text: JSON.stringify(responses[call++]), tokens: 10 })),
  };
}

const units: FlowUnitSummary[] = [
  { id: "u:routes", qualname: "src.api.routes", what: "Public API route handlers." },
  { id: "u:create_order", qualname: "src.orders.create_order", what: "Creates an order." },
];

describe("proposeFlowEntryPoints", () => {
  it("parses proposed entry points from the LLM response", async () => {
    const provider = fakeProvider([{ flows: [{ unit: "u:routes", name: "POST /orders", route: "POST /orders" }] }]);

    const result = await proposeFlowEntryPoints({ units, callEdges: [], provider, promptRev: "p1" });

    expect(result).toEqual([{ unit: "u:routes", name: "POST /orders", route: "POST /orders" }]);
  });

  it("passes structural route hints through into the prompt sent to the provider", async () => {
    const provider = fakeProvider([{ flows: [{ unit: "u:routes", name: "POST /orders", route: "POST /orders" }] }]);

    await proposeFlowEntryPoints({
      units,
      callEdges: [],
      provider,
      promptRev: "p1",
      routeHints: [{ unit: "u:routes", method: "post", path: "/orders" }],
    });

    expect(provider.interpret).toHaveBeenCalledWith(expect.stringContaining("Confirmed route handlers"), expect.anything());
  });

  it("drops proposed entry points whose unit id isn't in the real unit list", async () => {
    const provider = fakeProvider([
      {
        flows: [
          { unit: "u:routes", name: "POST /orders", route: "POST /orders" },
          { unit: "u:does_not_exist", name: "ghost", route: "ghost" },
        ],
      },
    ]);

    const result = await proposeFlowEntryPoints({ units, callEdges: [], provider, promptRev: "p1" });

    expect(result).toEqual([{ unit: "u:routes", name: "POST /orders", route: "POST /orders" }]);
  });
});

describe("narrateFlow", () => {
  it("narrates a traced flow's steps into what/how/when/where/why/tags/confidence", async () => {
    const provider = fakeProvider([
      {
        what: "The write path from HTTP to a persisted order.",
        how: "Two hops, router to handler.",
        when: "Per POST.",
        where: "src/api to src/orders.",
        why: "Every hop is blocking.",
        tags: ["hot-path"],
        confidence: 0.81,
      },
    ]);

    const result = await narrateFlow({
      route: "POST /orders",
      name: "POST /orders",
      steps: [
        { qualname: "src.api.routes", what: "Public API route handlers." },
        { qualname: "src.orders.create_order", what: "Creates an order." },
      ],
      provider,
      promptRev: "p1",
    });

    expect(result).toEqual({
      what: "The write path from HTTP to a persisted order.",
      how: "Two hops, router to handler.",
      when: "Per POST.",
      where: "src/api to src/orders.",
      why: "Every hop is blocking.",
      tags: ["hot-path"],
      confidence: 0.81,
      source: "llm",
    });
  });
});

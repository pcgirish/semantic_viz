import { describe, expect, it } from "vitest";
import { passCEntryPointsPrompt } from "../../src/prompts/pass-c-flows.js";
import type { CallEdge } from "../../src/checker.js";

const units = [
  { id: "u:orders.create_order", qualname: "orders.create_order", what: "Creates an order." },
  { id: "u:orders.helpers.validate", qualname: "orders.helpers.validate", what: "Validates order input." },
];
const edges: CallEdge[] = [{ from: "u:orders.create_order", to: "u:orders.helpers.validate" }];

describe("passCEntryPointsPrompt structural route hints", () => {
  it("omits the confirmed-routes section when no hints are given", () => {
    const prompt = passCEntryPointsPrompt(units, edges);

    expect(prompt).not.toContain("Confirmed route handlers");
  });

  it("lists structurally-detected route handlers as confirmed hints, instructing the LLM to include them", () => {
    const prompt = passCEntryPointsPrompt(units, edges, [{ unit: "u:orders.create_order", method: "post", path: "/orders" }]);

    expect(prompt).toContain("Confirmed route handlers");
    expect(prompt).toContain("u:orders.create_order");
    expect(prompt).toContain("POST /orders");
    expect(prompt.toLowerCase()).toContain("include");
  });

  it("still instructs looking for additional entry points beyond the hinted ones", () => {
    const prompt = passCEntryPointsPrompt(units, edges, [{ unit: "u:orders.create_order", method: "post", path: "/orders" }]);

    expect(prompt.toLowerCase()).toContain("beyond");
  });
});

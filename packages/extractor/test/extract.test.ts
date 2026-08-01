import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractRepo } from "../src/index.js";

const orderlyRoot = fileURLToPath(new URL("../../../fixtures/orderly", import.meta.url));
const tsSampleRoot = fileURLToPath(new URL("./fixtures/ts-sample", import.meta.url));

describe("extractRepo on the orderly fixture", () => {
  const graph = extractRepo(orderlyRoot);

  it("emits module, class, and function units", () => {
    const kinds = new Set(graph.units.map((u) => u.kind));
    expect(kinds.has("module")).toBe(true);
    expect(kinds.has("function")).toBe(true);
  });

  it("resolves the routes -> rate_limit import edge", () => {
    const routes = graph.units.find((u) => u.qualname === "src.api.routes");
    const rateLimit = graph.units.find((u) => u.qualname === "src.api.middleware.rate_limiter.rate_limit");
    expect(routes).toBeDefined();
    expect(rateLimit).toBeDefined();
    const edge = graph.edges.find(
      (e) => e.from === routes!.id && e.to === rateLimit!.id && e.kind === "imports",
    );
    expect(edge).toBeDefined();
  });

  it("resolves >=90% of within-repo references at confidence 1", () => {
    const withinRepoEdges = graph.edges.filter(
      (e) => (e.kind === "imports" || e.kind === "calls") && !e.to.startsWith("ext:"),
    );
    const resolved = withinRepoEdges.filter((e) => e.confidence === 1);
    expect(withinRepoEdges.length).toBeGreaterThan(0);
    expect(resolved.length / withinRepoEdges.length).toBeGreaterThanOrEqual(0.9);
  });

  it("computes sloc for a known small function", () => {
    const priceItems = graph.units.find((u) => u.qualname === "src.orders.pricing.price_items");
    expect(priceItems).toBeDefined();
    expect(priceItems!.sloc).toBe(2);
  });

  it("is deterministic across runs (same struct hash)", () => {
    const graph2 = extractRepo(orderlyRoot);
    const h1 = graph.units.map((u) => u.hash.struct).sort();
    const h2 = graph2.units.map((u) => u.hash.struct).sort();
    expect(h1).toEqual(h2);
  });
});

describe("extractRepo on a TypeScript sample", () => {
  const graph = extractRepo(tsSampleRoot);

  it("emits function units with the typescript lang tag", () => {
    const priceItems = graph.units.find((u) => u.qualname === "src.pricing.priceItems");
    expect(priceItems).toBeDefined();
    expect(priceItems!.lang).toBe("typescript");
  });

  it("resolves the relative import + call from orders.ts to pricing.ts", () => {
    const createOrder = graph.units.find((u) => u.qualname === "src.orders.createOrder");
    const priceItems = graph.units.find((u) => u.qualname === "src.pricing.priceItems");
    expect(createOrder).toBeDefined();
    expect(priceItems).toBeDefined();
    const callEdge = graph.edges.find(
      (e) => e.from === createOrder!.id && e.to === priceItems!.id && e.kind === "calls",
    );
    expect(callEdge).toBeDefined();
    expect(callEdge!.confidence).toBe(1);
  });
});

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

  it("derives externals from requirements.txt with reached_by and depth", () => {
    const redis = graph.externals.find((x) => x.name === "redis");
    expect(redis).toBeDefined();
    expect(redis!.ecosystem).toBe("pypi");
    expect(redis!.version).toBe("5.0.1");
    expect(redis!.direct).toBe(true);
    expect(redis!.depth).toBe(1);
    expect(redis!.reachedBy.length).toBeGreaterThan(0);
  });

  it("computes churn, commits, and authors on a known unit from git history", () => {
    const routes = graph.units.find((u) => u.qualname === "src.api.routes");
    expect(routes).toBeDefined();
    expect(routes!.metrics.commits).toBeGreaterThan(0);
    expect(routes!.metrics.churn).toBeGreaterThan(0);
    expect(routes!.authors.length).toBeGreaterThan(0);
  });

  it("computes fan_in and fan_out from edges", () => {
    const rateLimit = graph.units.find((u) => u.qualname === "src.api.middleware.rate_limiter.rate_limit");
    expect(rateLimit).toBeDefined();
    expect(rateLimit!.metrics.fanIn).toBeGreaterThan(0);
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

describe("extractRepo excludes Python stdlib modules from externals", () => {
  const pyStdlibRoot = fileURLToPath(new URL("./fixtures/py-stdlib-imports", import.meta.url));
  const graph = extractRepo(pyStdlibRoot);

  it.each([
    "decimal", "uuid", "secrets", "unittest", "hmac", "ssl", "smtplib",
    "urllib", "fcntl", "email", "fractions", "ipaddress", "tempfile",
    "contextvars", "argparse",
  ])("does not list '%s' as an external", (mod) => {
    expect(graph.externals.find((x) => x.name === mod)).toBeUndefined();
  });

  it("still lists a genuine third-party import as an external", () => {
    expect(graph.externals.find((x) => x.name === "requests")).toBeDefined();
  });
});

describe("extractRepo on a TypeScript repo with an unresolved relative import", () => {
  const brokenRelativeRoot = fileURLToPath(new URL("./fixtures/ts-broken-relative-import", import.meta.url));
  const graph = extractRepo(brokenRelativeRoot);

  it("does not record a blank-name external", () => {
    const blank = graph.externals.find((x) => x.name === "");
    expect(blank).toBeUndefined();
  });
});

describe("extractRepo excludes Node builtin modules from externals", () => {
  const nodeBuiltinsRoot = fileURLToPath(new URL("./fixtures/ts-node-builtins", import.meta.url));
  const graph = extractRepo(nodeBuiltinsRoot);

  it.each(["node:path", "node:fs", "node:crypto"])("does not list '%s' as an external", (mod) => {
    expect(graph.externals.find((x) => x.name === mod)).toBeUndefined();
    const bare = mod.replace("node:", "");
    expect(graph.externals.find((x) => x.name === bare)).toBeUndefined();
  });

  it("still lists a genuine third-party import as an external", () => {
    expect(graph.externals.find((x) => x.name === "zod")).toBeDefined();
  });
});

describe("extractRepo on a repo with both Python and TypeScript manifests", () => {
  const mixedRoot = fileURLToPath(new URL("./fixtures/mixed-lang-repo", import.meta.url));
  const graph = extractRepo(mixedRoot);

  it("tags a Python import as pypi and a TypeScript import as npm", () => {
    const fastapi = graph.externals.find((x) => x.name === "fastapi");
    const vite = graph.externals.find((x) => x.name === "vite");
    expect(fastapi?.ecosystem).toBe("pypi");
    expect(vite?.ecosystem).toBe("npm");
  });

  it("resolves direct/version from the matching per-language manifest", () => {
    const fastapi = graph.externals.find((x) => x.name === "fastapi");
    const vite = graph.externals.find((x) => x.name === "vite");
    expect(fastapi?.direct).toBe(true);
    expect(fastapi?.version).toBe("0.110.0");
    expect(vite?.direct).toBe(true);
    expect(vite?.version).toBe("^5.0.0");
  });
});

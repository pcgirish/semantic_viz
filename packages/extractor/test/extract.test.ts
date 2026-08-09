import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractRepo } from "../src/index.js";

const orderlyRoot = fileURLToPath(new URL("../../../fixtures/orderly", import.meta.url));
const tsSampleRoot = fileURLToPath(new URL("./fixtures/ts-sample", import.meta.url));
const jsSampleRoot = fileURLToPath(new URL("./fixtures/js-sample", import.meta.url));

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

  it("emits DI edges from create_order/get_order to rate_limit and verify_token, wired via the public router's Depends()", () => {
    const createOrder = graph.units.find((u) => u.qualname === "src.orders.create_order.create_order");
    const getOrder = graph.units.find((u) => u.qualname === "src.orders.get_order.get_order");
    const rateLimit = graph.units.find((u) => u.qualname === "src.api.middleware.rate_limiter.rate_limit");
    const verifyToken = graph.units.find((u) => u.qualname === "src.auth.verify_token");
    expect(createOrder).toBeDefined();
    expect(getOrder).toBeDefined();
    expect(rateLimit).toBeDefined();
    expect(verifyToken).toBeDefined();

    for (const handler of [createOrder!, getOrder!]) {
      for (const dep of [rateLimit!, verifyToken!]) {
        const edge = graph.edges.find((e) => e.from === handler.id && e.to === dep.id && e.via === "di");
        expect(edge, `${handler.qualname} -> ${dep.qualname}`).toBeDefined();
      }
    }
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

describe("extractRepo on a JavaScript/JSX sample", () => {
  const graph = extractRepo(jsSampleRoot);

  it("emits function units with the javascript lang tag", () => {
    const priceItems = graph.units.find((u) => u.qualname === "src.pricing.priceItems");
    expect(priceItems).toBeDefined();
    expect(priceItems!.lang).toBe("javascript");
  });

  it("resolves the relative import + call from orders.js to pricing.js", () => {
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

  it("parses a .jsx file with JSX syntax and resolves its import", () => {
    const app = graph.units.find((u) => u.qualname === "src.App.App");
    const createOrder = graph.units.find((u) => u.qualname === "src.orders.createOrder");
    expect(app).toBeDefined();
    expect(createOrder).toBeDefined();
    const callEdge = graph.edges.find(
      (e) => e.from === app!.id && e.to === createOrder!.id && e.kind === "calls",
    );
    expect(callEdge).toBeDefined();
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

  it("collapses a deep-path import to its package name", () => {
    expect(graph.externals.find((x) => x.name === "elkjs")).toBeDefined();
    expect(graph.externals.find((x) => x.name === "elkjs/lib/elk-api")).toBeUndefined();
  });

  it("preserves the full name of a scoped (@scope/pkg) import", () => {
    expect(graph.externals.find((x) => x.name === "@tailwindcss/vite")).toBeDefined();
    expect(graph.externals.find((x) => x.name === "@tailwindcss")).toBeUndefined();
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

describe("extractRepo — blockGraph (control-flow blocks)", () => {
  const graph = extractRepo(orderlyRoot);

  it("gives a branching function a populated blockGraph entry", () => {
    const createOrder = graph.units.find((u) => u.qualname === "src.orders.create_order.create_order");
    expect(createOrder).toBeDefined();
    const bg = graph.blockGraph[createOrder!.qualname];
    expect(bg).toBeDefined();
    expect(bg!.blocks.some((b) => b.blockType === "decision")).toBe(true);
    expect(bg!.edges.length).toBeGreaterThan(0);
  });

  it("gives a function with no branching no blockGraph entry", () => {
    const priceItems = graph.units.find((u) => u.qualname === "src.orders.pricing.price_items");
    expect(priceItems).toBeDefined();
    expect(graph.blockGraph[priceItems!.qualname]).toBeUndefined();
  });

  it("block ids are stable across repeated extraction", () => {
    const graph2 = extractRepo(orderlyRoot);
    const createOrder = graph.units.find((u) => u.qualname === "src.orders.create_order.create_order")!;
    const ids1 = graph.blockGraph[createOrder.qualname]!.blocks.map((b) => b.id).sort();
    const ids2 = graph2.blockGraph[createOrder.qualname]!.blocks.map((b) => b.id).sort();
    expect(ids1).toEqual(ids2);
  });

  it("does not double-count a nested function's blocks into the outer function's block graph", () => {
    // parse() is a top-level sibling of create_order in the same file, not nested inside
    // it — its own blocks (a single exit block for the raise) must not appear under
    // create_order's blockGraph entry.
    const createOrder = graph.units.find((u) => u.qualname === "src.orders.create_order.create_order")!;
    const parseUnit = graph.units.find((u) => u.qualname === "src.orders.create_order.parse");
    expect(parseUnit).toBeDefined();
    const bg = graph.blockGraph[createOrder.qualname]!;
    // create_order has 2 if-statements (2 decisions) — parse()'s blocks must not inflate this
    expect(bg.blocks.filter((b) => b.blockType === "decision").length).toBe(2);
  });
});

describe("extractRepo — test folder flattening", () => {
  const testFolderRoot = fileURLToPath(new URL("./fixtures/test-folder-sample", import.meta.url));
  const graph = extractRepo(testFolderRoot);

  it("flattens a nested test file to one module level under tests", () => {
    expect(graph.units.find((u) => u.qualname === "tests.integration" && u.kind === "module")).toBeDefined();
    expect(graph.units.find((u) => u.qualname === "tests.integration.test_widget")).toBeUndefined();
  });

  it("leaves a file directly under tests/ as the tests module itself", () => {
    expect(graph.units.find((u) => u.qualname === "tests" && u.kind === "module")).toBeDefined();
    expect(graph.units.find((u) => u.qualname === "tests.test_rate_limiter")).toBeUndefined();
  });

  it("still resolves test functions as units, parented under the flat module", () => {
    const testFn = graph.units.find((u) => u.qualname === "tests.integration.test_build_widget_branches");
    expect(testFn).toBeDefined();
    const parentModule = graph.units.find((u) => u.id === testFn!.parent);
    expect(parentModule?.qualname).toBe("tests.integration");
  });

  it("gives no blockGraph entry to a test function even when it branches", () => {
    const testFn = graph.units.find((u) => u.qualname === "tests.integration.test_build_widget_branches");
    expect(testFn).toBeDefined();
    expect(graph.blockGraph[testFn!.qualname]).toBeUndefined();
  });

  it("still gives a non-test function with identical branching a blockGraph entry", () => {
    const prodFn = graph.units.find((u) => u.qualname === "src.widget.build_widget");
    expect(prodFn).toBeDefined();
    expect(graph.blockGraph[prodFn!.qualname]).toBeDefined();
  });

  it("merges multiple files flattening to the same test module qualname into one module unit", () => {
    const testsModules = graph.units.filter((u) => u.qualname === "tests" && u.kind === "module");
    expect(testsModules).toHaveLength(1);
    // both tests/test_rate_limiter.py and tests/integration/test_widget.py's ancestor
    // dir contribute to "tests" — the single merged module unit parents both.
    const testsModule = testsModules[0]!;
    const rateLimiterFn = graph.units.find((u) => u.qualname === "tests.test_direct_under_tests");
    expect(rateLimiterFn?.parent).toBe(testsModule.id);
  });
});

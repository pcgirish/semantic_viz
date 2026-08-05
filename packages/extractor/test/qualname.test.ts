import { describe, expect, it } from "vitest";
import { moduleQualname, isTestPath, flattenTestQualname } from "../src/qualname.js";

describe("moduleQualname", () => {
  it("strips .py", () => {
    expect(moduleQualname("src/orders/pricing.py")).toBe("src.orders.pricing");
  });

  it("strips .ts and .tsx", () => {
    expect(moduleQualname("src/widget.ts")).toBe("src.widget");
    expect(moduleQualname("src/App.tsx")).toBe("src.App");
  });

  it("strips .js, .jsx, .mjs, .cjs", () => {
    expect(moduleQualname("src/widget.js")).toBe("src.widget");
    expect(moduleQualname("src/App.jsx")).toBe("src.App");
    expect(moduleQualname("src/widget.mjs")).toBe("src.widget");
    expect(moduleQualname("src/widget.cjs")).toBe("src.widget");
  });

  it("collapses __init__ and index to the package", () => {
    expect(moduleQualname("src/pkg/__init__.py")).toBe("src.pkg");
    expect(moduleQualname("src/pkg/index.ts")).toBe("src.pkg");
    expect(moduleQualname("src/pkg/index.js")).toBe("src.pkg");
  });
});

describe("isTestPath", () => {
  it("detects files under a tests/ or test/ directory", () => {
    expect(isTestPath("tests/integration/test_orders.py")).toBe(true);
    expect(isTestPath("test/unit/widget.spec.ts")).toBe(true);
  });

  it("detects __tests__ directories", () => {
    expect(isTestPath("src/orders/__tests__/pricing.ts")).toBe(true);
  });

  it("detects test-named files outside a tests dir", () => {
    expect(isTestPath("src/orders/test_pricing.py")).toBe(true);
    expect(isTestPath("src/orders/pricing_test.py")).toBe(true);
    expect(isTestPath("src/widget.test.ts")).toBe(true);
    expect(isTestPath("src/widget.test.tsx")).toBe(true);
    expect(isTestPath("src/widget.spec.ts")).toBe(true);
  });

  it("does not flag ordinary production files", () => {
    expect(isTestPath("src/orders/pricing.py")).toBe(false);
    expect(isTestPath("src/widget.ts")).toBe(false);
  });

  it("does not flag production helper files merely containing 'test' as a substring", () => {
    expect(isTestPath("src/orders/latest_price.py")).toBe(false);
    expect(isTestPath("src/orders/attestation.py")).toBe(false);
  });
});

describe("flattenTestQualname", () => {
  it("collapses to one level under tests/ when nested deeper", () => {
    expect(flattenTestQualname("tests.integration.test_orders", "tests/integration/test_orders.py")).toBe(
      "tests.integration",
    );
  });

  it("collapses multi-level nesting to the single level under tests/", () => {
    expect(
      flattenTestQualname(
        "tests.integration.api.test_deep",
        "tests/integration/api/test_deep.py",
      ),
    ).toBe("tests.integration");
  });

  it("leaves a file directly under tests/ as the tests module itself", () => {
    expect(flattenTestQualname("tests.test_rate_limiter", "tests/test_rate_limiter.py")).toBe("tests");
  });

  it("leaves non-test qualnames untouched", () => {
    expect(flattenTestQualname("src.orders.pricing", "src/orders/pricing.py")).toBe("src.orders.pricing");
  });
});

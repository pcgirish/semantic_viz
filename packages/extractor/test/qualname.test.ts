import { describe, expect, it } from "vitest";
import { moduleQualname } from "../src/qualname.js";

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

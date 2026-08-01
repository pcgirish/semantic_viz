import { describe, expect, it } from "vitest";
import { langForFile } from "../src/grammars/registry.js";

describe("langForFile", () => {
  it("recognizes .py as python", () => {
    expect(langForFile("src/app.py")).toBe("python");
  });

  it("recognizes .ts as typescript, excluding .d.ts", () => {
    expect(langForFile("src/app.ts")).toBe("typescript");
    expect(langForFile("src/app.d.ts")).toBeNull();
  });

  it("recognizes .tsx as typescript", () => {
    expect(langForFile("src/App.tsx")).toBe("typescript");
  });

  it("recognizes .js as javascript", () => {
    expect(langForFile("src/app.js")).toBe("javascript");
  });

  it("recognizes .jsx as javascript", () => {
    expect(langForFile("src/App.jsx")).toBe("javascript");
  });

  it("recognizes .mjs and .cjs as javascript", () => {
    expect(langForFile("src/app.mjs")).toBe("javascript");
    expect(langForFile("src/app.cjs")).toBe("javascript");
  });

  it("returns null for unsupported extensions", () => {
    expect(langForFile("README.md")).toBeNull();
    expect(langForFile("src/app.go")).toBeNull();
  });
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadInterpreterConfig } from "../src/config.js";

describe("loadInterpreterConfig validation", () => {
  let scvDir: string;

  beforeEach(() => {
    scvDir = mkdtempSync(path.join(tmpdir(), "scv-config-"));
  });

  afterEach(() => {
    rmSync(scvDir, { recursive: true, force: true });
  });

  function writeConfig(body: string): void {
    writeFileSync(path.join(scvDir, "config.yaml"), body);
  }

  it("rejects an unknown provider instead of handing it to createProvider", () => {
    writeConfig("interpreter:\n  provider: gpt-9\n");
    expect(() => loadInterpreterConfig(scvDir)).toThrow(/config\.yaml.*provider/s);
  });

  it("rejects an out-of-range effort", () => {
    writeConfig("interpreter:\n  provider: ollama\n  effort: extreme\n");
    expect(() => loadInterpreterConfig(scvDir)).toThrow(/config\.yaml.*effort/s);
  });

  it("rejects a non-string model", () => {
    writeConfig("interpreter:\n  provider: ollama\n  model: 42\n");
    expect(() => loadInterpreterConfig(scvDir)).toThrow(/config\.yaml.*model/s);
  });

  it("still accepts a valid config and applies the ollama default", () => {
    writeConfig("interpreter:\n  model: qwen3\n");
    expect(loadInterpreterConfig(scvDir)).toEqual({ provider: "ollama", model: "qwen3" });
  });

  it("returns the default when the file is absent", () => {
    expect(loadInterpreterConfig(scvDir)).toEqual({ provider: "ollama" });
  });
});

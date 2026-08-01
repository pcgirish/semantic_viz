import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadInterpreterConfig } from "../src/config.js";

describe("loadInterpreterConfig", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "scv-interp-config-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads provider and model from .scv/config.yaml", () => {
    const scvDir = path.join(dir, ".scv");
    mkdirSync(scvDir);
    writeFileSync(
      path.join(scvDir, "config.yaml"),
      "interpreter:\n  provider: ollama\n  model: qwen3.5:0.8b-mlx\n",
    );

    const config = loadInterpreterConfig(scvDir);
    expect(config).toEqual({ provider: "ollama", model: "qwen3.5:0.8b-mlx" });
  });

  it("defaults to ollama when no config file exists", () => {
    const config = loadInterpreterConfig(path.join(dir, ".scv"));
    expect(config.provider).toBe("ollama");
  });
});

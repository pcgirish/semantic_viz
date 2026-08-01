import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadInterpreterConfig, writeInterpreterConfig } from "../src/config.js";

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

  it("reads effort from .scv/config.yaml", () => {
    const scvDir = path.join(dir, ".scv");
    mkdirSync(scvDir);
    writeFileSync(
      path.join(scvDir, "config.yaml"),
      "interpreter:\n  provider: claude-cli\n  effort: high\n",
    );

    const config = loadInterpreterConfig(scvDir);
    expect(config).toEqual({ provider: "claude-cli", effort: "high" });
  });

  it("defaults to ollama when no config file exists", () => {
    const config = loadInterpreterConfig(path.join(dir, ".scv"));
    expect(config.provider).toBe("ollama");
  });
});

describe("writeInterpreterConfig", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "scv-interp-config-write-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates .scv/config.yaml (and .scv/) when absent", () => {
    const scvDir = path.join(dir, ".scv");
    writeInterpreterConfig(scvDir, { provider: "anthropic", model: "claude-sonnet-5" });

    expect(existsSync(path.join(scvDir, "config.yaml"))).toBe(true);
    expect(loadInterpreterConfig(scvDir)).toEqual({ provider: "anthropic", model: "claude-sonnet-5" });
  });

  it("round-trips provider, model, and effort", () => {
    const scvDir = path.join(dir, ".scv");
    writeInterpreterConfig(scvDir, { provider: "claude-cli", model: "sonnet", effort: "max" });

    expect(loadInterpreterConfig(scvDir)).toEqual({ provider: "claude-cli", model: "sonnet", effort: "max" });
  });

  it("overwrites an existing config.yaml", () => {
    const scvDir = path.join(dir, ".scv");
    writeInterpreterConfig(scvDir, { provider: "ollama", model: "a" });
    writeInterpreterConfig(scvDir, { provider: "anthropic", model: "b" });

    expect(loadInterpreterConfig(scvDir)).toEqual({ provider: "anthropic", model: "b" });
  });

  it("writes valid YAML under an interpreter: key", () => {
    const scvDir = path.join(dir, ".scv");
    writeInterpreterConfig(scvDir, { provider: "ollama" });

    const raw = readFileSync(path.join(scvDir, "config.yaml"), "utf-8");
    expect(raw).toContain("interpreter:");
    expect(raw).toContain("provider: ollama");
  });
});

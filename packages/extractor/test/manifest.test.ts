import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseManifests } from "../src/manifest.js";

const orderlyRoot = fileURLToPath(new URL("../../../fixtures/orderly", import.meta.url));

describe("parseManifests on the orderly fixture", () => {
  it("reads pinned versions from requirements.txt", () => {
    const manifest = parseManifests(orderlyRoot);
    const redis = manifest.pinned.get("redis");
    expect(redis).toBe("5.0.1");
    expect(manifest.pinned.get("fastapi")).toBe("0.110.0");
  });

  it("marks python ecosystem", () => {
    const manifest = parseManifests(orderlyRoot);
    expect(manifest.ecosystem).toBe("pypi");
  });
});

describe("parseManifests on a package.json repo", () => {
  const tsSampleRoot = fileURLToPath(new URL("./fixtures/ts-sample", import.meta.url));

  it("returns an empty pinned map when no manifest is present", () => {
    const manifest = parseManifests(tsSampleRoot);
    expect(manifest.pinned.size).toBe(0);
  });
});

describe("parseManifests on a pyproject.toml (uv) repo", () => {
  const pyprojectRoot = fileURLToPath(new URL("./fixtures/pyproject-uv", import.meta.url));

  it("marks pypi ecosystem", () => {
    const manifest = parseManifests(pyprojectRoot);
    expect(manifest.ecosystem).toBe("pypi");
  });

  it("reads a pinned (==) dependency version", () => {
    const manifest = parseManifests(pyprojectRoot);
    expect(manifest.pinned.get("fastapi")).toBe("0.110.0");
  });

  it("records an unpinned dependency with a null version", () => {
    const manifest = parseManifests(pyprojectRoot);
    expect(manifest.pinned.has("sqlalchemy")).toBe(true);
    expect(manifest.pinned.get("sqlalchemy")).toBeNull();
    expect(manifest.pinned.has("structlog")).toBe(true);
    expect(manifest.pinned.get("structlog")).toBeNull();
  });

  it("does not read dependency-groups (dev) dependencies", () => {
    const manifest = parseManifests(pyprojectRoot);
    expect(manifest.pinned.has("pytest")).toBe(false);
  });

  it("strips extras (e.g. sqlalchemy[asyncio]) from the dependency name", () => {
    const manifest = parseManifests(pyprojectRoot);
    expect(manifest.pinned.has("sqlalchemy")).toBe(true);
    expect(manifest.pinned.has("sqlalchemy[asyncio]")).toBe(false);
  });

  it("reads every dependency in the array, not just up to the first ']'", () => {
    const manifest = parseManifests(pyprojectRoot);
    expect(manifest.pinned.size).toBe(3);
  });
});

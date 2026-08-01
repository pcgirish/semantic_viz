import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseManifests } from "../src/manifest.js";

const orderlyRoot = fileURLToPath(new URL("../../../fixtures/orderly", import.meta.url));

describe("parseManifests on the orderly fixture", () => {
  it("reads pinned versions from requirements.txt", () => {
    const manifest = parseManifests(orderlyRoot);
    expect(manifest.pypi?.pinned.get("redis")).toBe("5.0.1");
    expect(manifest.pypi?.pinned.get("fastapi")).toBe("0.110.0");
  });

  it("marks python ecosystem and no npm manifest", () => {
    const manifest = parseManifests(orderlyRoot);
    expect(manifest.pypi?.ecosystem).toBe("pypi");
    expect(manifest.npm).toBeNull();
  });
});

describe("parseManifests on a package.json repo", () => {
  const tsSampleRoot = fileURLToPath(new URL("./fixtures/ts-sample", import.meta.url));

  it("returns null for the pypi manifest when no package.json/pyproject.toml pairing is present", () => {
    const manifest = parseManifests(tsSampleRoot);
    expect(manifest.pypi).toBeNull();
    expect(manifest.npm).toBeNull();
  });
});

describe("parseManifests on a pyproject.toml (uv) repo", () => {
  const pyprojectRoot = fileURLToPath(new URL("./fixtures/pyproject-uv", import.meta.url));

  it("marks pypi ecosystem", () => {
    const manifest = parseManifests(pyprojectRoot);
    expect(manifest.pypi?.ecosystem).toBe("pypi");
  });

  it("reads a pinned (==) dependency version", () => {
    const manifest = parseManifests(pyprojectRoot);
    expect(manifest.pypi?.pinned.get("fastapi")).toBe("0.110.0");
  });

  it("records an unpinned dependency with a null version", () => {
    const manifest = parseManifests(pyprojectRoot);
    expect(manifest.pypi?.pinned.has("sqlalchemy")).toBe(true);
    expect(manifest.pypi?.pinned.get("sqlalchemy")).toBeNull();
    expect(manifest.pypi?.pinned.has("structlog")).toBe(true);
    expect(manifest.pypi?.pinned.get("structlog")).toBeNull();
  });

  it("does not read dependency-groups (dev) dependencies", () => {
    const manifest = parseManifests(pyprojectRoot);
    expect(manifest.pypi?.pinned.has("pytest")).toBe(false);
  });

  it("strips extras (e.g. sqlalchemy[asyncio]) from the dependency name", () => {
    const manifest = parseManifests(pyprojectRoot);
    expect(manifest.pypi?.pinned.has("sqlalchemy")).toBe(true);
    expect(manifest.pypi?.pinned.has("sqlalchemy[asyncio]")).toBe(false);
  });

  it("reads every dependency in the array, not just up to the first ']'", () => {
    const manifest = parseManifests(pyprojectRoot);
    expect(manifest.pypi?.pinned.size).toBe(3);
  });
});

describe("parseManifests on a repo with both pyproject.toml and package.json", () => {
  const mixedRoot = fileURLToPath(new URL("./fixtures/mixed-pypi-npm", import.meta.url));

  it("reads both manifests independently", () => {
    const manifest = parseManifests(mixedRoot);
    expect(manifest.pypi?.ecosystem).toBe("pypi");
    expect(manifest.pypi?.pinned.get("fastapi")).toBe("0.110.0");
    expect(manifest.npm?.ecosystem).toBe("npm");
    expect(manifest.npm?.pinned.get("vite")).toBe("^5.0.0");
  });
});

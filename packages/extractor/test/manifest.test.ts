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

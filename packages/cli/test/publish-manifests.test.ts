import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface Manifest {
  name: string;
  version: string;
  private?: boolean;
  bin?: Record<string, string>;
  files?: string[];
  exports?: Record<string, unknown>;
  engines?: { node?: string };
  publishConfig?: { access?: string };
  license?: string;
  dependencies?: Record<string, string>;
}

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const read = (dir: string): Manifest => JSON.parse(readFileSync(path.join(repoRoot, dir, "package.json"), "utf-8"));
const workspaceDirs = ["packages", "packages/skins"].flatMap((parent) =>
  readdirSync(path.join(repoRoot, parent), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "skins")
    .map((d) => `${parent}/${d.name}`),
);
const workspaces = new Map(workspaceDirs.map((dir) => [read(dir).name, read(dir)]));

const PUBLISHED = ["semviz", "@semviz/schema", "@semviz/extractor", "@semviz/interpreter", "@semviz/differ", "@semviz/viewer"];
const manifest = (name: string) => workspaces.get(name)!;

describe("publish manifests", () => {
  it("keeps the root and every non-published workspace private", () => {
    expect(read(".").private).toBe(true);
    for (const [name, pkg] of workspaces) if (!PUBLISHED.includes(name)) expect(pkg.private, name).toBe(true);
  });

  it.each(PUBLISHED)("%s is publishable", (name) => {
    const pkg = manifest(name);
    expect(pkg.private).toBeUndefined();
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.version).not.toBe("0.0.0");
    expect(pkg.files).toContain("dist");
    expect(pkg.engines?.node).toBe(read(".").engines?.node);
    expect(pkg.license).toBe("Apache-2.0");
    if (name.startsWith("@")) expect(pkg.publishConfig?.access).toBe("public");
  });

  it.each(PUBLISHED)("%s depends only on third-party packages and published workspaces, by real version", (name) => {
    for (const [dep, range] of Object.entries(manifest(name).dependencies ?? {})) {
      expect(range, `${name} -> ${dep}`).not.toBe("*");
      const workspace = workspaces.get(dep);
      if (!workspace) continue;
      expect(PUBLISHED, `${name} -> ${dep}`).toContain(dep);
      expect(range, `${name} -> ${dep}`).toBe(`^${workspace.version}`);
    }
  });

  it("library packages export their built entry point", () => {
    for (const name of PUBLISHED.filter((n) => n !== "@semviz/viewer")) {
      expect(manifest(name).exports?.["."], name).toEqual({ types: "./dist/index.d.ts", import: "./dist/index.js" });
    }
  });

  it("the CLI is lean: bin scv, bundled skills, no viewer runtime", () => {
    const cli = manifest("semviz");
    expect(cli.bin).toEqual({ scv: "./dist/bin.js" });
    expect(cli.files).toContain("skills");
    for (const dep of ["fastify", "@fastify/static", "@fastify/http-proxy", "@semviz/server", "@semviz/ui"]) {
      expect(cli.dependencies).not.toHaveProperty(dep);
    }
  });

  it("the viewer is self-contained: bin scv-viewer, runtime deps third-party plus @semviz/schema", () => {
    const viewer = manifest("@semviz/viewer");
    expect(viewer.bin).toEqual({ "scv-viewer": "./dist/bin.js" });
    const workspaceDeps = Object.keys(viewer.dependencies ?? {}).filter((dep) => workspaces.has(dep));
    expect(workspaceDeps).toEqual(["@semviz/schema"]);
  });
});

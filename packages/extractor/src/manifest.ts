import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface ManifestInfo {
  ecosystem: "pypi" | "npm" | null;
  pinned: Map<string, string>;
}

function parseRequirementsTxt(text: string): Map<string, string> {
  const pinned = new Map<string, string>();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const [name, version] = line.split("==");
    if (name && version) pinned.set(name.trim(), version.trim());
  }
  return pinned;
}

function parsePackageJson(text: string): Map<string, string> {
  const pinned = new Map<string, string>();
  const pkg = JSON.parse(text) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  for (const deps of [pkg.dependencies, pkg.devDependencies]) {
    if (!deps) continue;
    for (const [name, version] of Object.entries(deps)) pinned.set(name, version);
  }
  return pinned;
}

export function parseManifests(root: string): ManifestInfo {
  const requirementsPath = path.join(root, "requirements.txt");
  if (existsSync(requirementsPath)) {
    return { ecosystem: "pypi", pinned: parseRequirementsTxt(readFileSync(requirementsPath, "utf-8")) };
  }
  const packageJsonPath = path.join(root, "package.json");
  if (existsSync(packageJsonPath)) {
    return { ecosystem: "npm", pinned: parsePackageJson(readFileSync(packageJsonPath, "utf-8")) };
  }
  return { ecosystem: null, pinned: new Map() };
}

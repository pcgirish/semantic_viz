import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface ManifestInfo {
  ecosystem: "pypi" | "npm" | null;
  pinned: Map<string, string | null>;
}

function parseRequirementsTxt(text: string): Map<string, string | null> {
  const pinned = new Map<string, string | null>();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const [name, version] = line.split("==");
    if (name && version) pinned.set(name.trim(), version.trim());
  }
  return pinned;
}

function parsePackageJson(text: string): Map<string, string | null> {
  const pinned = new Map<string, string | null>();
  const pkg = JSON.parse(text) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  for (const deps of [pkg.dependencies, pkg.devDependencies]) {
    if (!deps) continue;
    for (const [name, version] of Object.entries(deps)) pinned.set(name, version);
  }
  return pinned;
}

/** Extracts the top-level `dependencies = [...]` array from `[project]` in a pyproject.toml. */
function extractProjectDependenciesArray(text: string): string | null {
  const projectMatch = /^\[project\]\s*$/m.exec(text);
  if (!projectMatch) return null;
  const afterProject = text.slice(projectMatch.index + projectMatch[0].length);
  const nextTableMatch = /^\[.+\]\s*$/m.exec(afterProject);
  const projectBody = nextTableMatch ? afterProject.slice(0, nextTableMatch.index) : afterProject;
  const depsMatch = /dependencies\s*=\s*\[([\s\S]*?)^\s*\]/m.exec(projectBody);
  return depsMatch ? depsMatch[1]! : null;
}

/** Parses a PEP 508 requirement string ("fastapi==0.110.0", "sqlalchemy>=2.0.0", "structlog") into name + pinned version. */
function parsePep508Requirement(requirement: string): { name: string; version: string | null } | null {
  const trimmed = requirement.trim();
  if (!trimmed) return null;
  const pinnedMatch = /^([A-Za-z0-9_.-]+)\s*==\s*([^,;\s]+)/.exec(trimmed);
  if (pinnedMatch) return { name: pinnedMatch[1]!, version: pinnedMatch[2]! };
  const nameMatch = /^([A-Za-z0-9_.-]+)/.exec(trimmed);
  return nameMatch ? { name: nameMatch[1]!, version: null } : null;
}

function parsePyprojectToml(text: string): Map<string, string | null> {
  const pinned = new Map<string, string | null>();
  const depsArrayBody = extractProjectDependenciesArray(text);
  if (!depsArrayBody) return pinned;
  for (const rawEntry of depsArrayBody.split(",")) {
    const entryMatch = /"([^"]+)"|'([^']+)'/.exec(rawEntry);
    const requirement = entryMatch?.[1] ?? entryMatch?.[2];
    if (!requirement) continue;
    const parsed = parsePep508Requirement(requirement);
    if (parsed) pinned.set(parsed.name, parsed.version);
  }
  return pinned;
}

export function parseManifests(root: string): ManifestInfo {
  const requirementsPath = path.join(root, "requirements.txt");
  if (existsSync(requirementsPath)) {
    return { ecosystem: "pypi", pinned: parseRequirementsTxt(readFileSync(requirementsPath, "utf-8")) };
  }
  const pyprojectPath = path.join(root, "pyproject.toml");
  if (existsSync(pyprojectPath)) {
    return { ecosystem: "pypi", pinned: parsePyprojectToml(readFileSync(pyprojectPath, "utf-8")) };
  }
  const packageJsonPath = path.join(root, "package.json");
  if (existsSync(packageJsonPath)) {
    return { ecosystem: "npm", pinned: parsePackageJson(readFileSync(packageJsonPath, "utf-8")) };
  }
  return { ecosystem: null, pinned: new Map() };
}

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export interface ManifestInfo {
  ecosystem: "pypi" | "npm" | null;
  pinned: Map<string, string | null>;
}

export interface RepoManifests {
  pypi: ManifestInfo | null;
  npm: ManifestInfo | null;
}

const SKIP_DIRS = new Set(["__pycache__", ".git", ".scv", "node_modules", "dist"]);

/** Finds every file matching `name` under root, skipping the same dirs the extractor's file walker skips. */
function findManifestFiles(root: string, name: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        stack.push(full);
      } else if (entry === name) {
        out.push(full);
      }
    }
  }
  return out.sort();
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

/** Merges pinned maps found across a repo; root-most (shallowest path) files are applied last, so they win on name conflicts. */
function mergePinned(entries: { file: string; pinned: Map<string, string | null> }[]): Map<string, string | null> {
  const byDepth = [...entries].sort((a, b) => b.file.split(path.sep).length - a.file.split(path.sep).length);
  const merged = new Map<string, string | null>();
  for (const { pinned } of byDepth) {
    for (const [name, version] of pinned) merged.set(name, version);
  }
  return merged;
}

function parsePypiManifest(root: string): ManifestInfo | null {
  const requirementsFiles = findManifestFiles(root, "requirements.txt").map((file) => ({
    file,
    pinned: parseRequirementsTxt(readFileSync(file, "utf-8")),
  }));
  const pyprojectFiles = findManifestFiles(root, "pyproject.toml").map((file) => ({
    file,
    pinned: parsePyprojectToml(readFileSync(file, "utf-8")),
  }));
  const entries = [...requirementsFiles, ...pyprojectFiles];
  if (entries.length === 0) return null;
  return { ecosystem: "pypi", pinned: mergePinned(entries) };
}

function parseNpmManifest(root: string): ManifestInfo | null {
  const entries = findManifestFiles(root, "package.json").map((file) => ({
    file,
    pinned: parsePackageJson(readFileSync(file, "utf-8")),
  }));
  if (entries.length === 0) return null;
  return { ecosystem: "npm", pinned: mergePinned(entries) };
}

/** Reads every requirements.txt/pyproject.toml and package.json anywhere in the repo (skipping node_modules etc.), merging pinned deps per ecosystem. */
export function parseManifests(root: string): RepoManifests {
  return { pypi: parsePypiManifest(root), npm: parseNpmManifest(root) };
}

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gitIgnoredPaths } from "@semviz/extractor";

const DOC_EXTENSIONS = new Set([".md", ".rst"]);
const IGNORED_DIRS = new Set(["node_modules", ".git", ".scv"]);
const DOCS_DIR_NAMES = new Set(["docs", "documentation"]);
const MIN_CONTENT_LENGTH = 20;

export interface DiscoveredDoc {
  path: string;
  content: string;
}

function isDocFile(name: string): boolean {
  return DOC_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function collectDocFiles(dir: string, relDir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      files.push(...collectDocFiles(path.join(dir, entry.name), path.posix.join(relDir, entry.name)));
    } else if (entry.isFile() && isDocFile(entry.name)) {
      files.push(path.posix.join(relDir, entry.name));
    }
  }

  return files;
}

/**
 * Finds markdown/rst docs worth feeding to Pass Docs: root-level doc files, plus anything under
 * a top-level `docs/`/`documentation/` directory (case-insensitive), recursively. Generic by
 * design — no hardcoded filenames, since scv analyzes arbitrary target repos. Docs git ignores
 * are skipped: a fresh clone, such as CI's, would not have them.
 */
export function discoverDocs(root: string): DiscoveredDoc[] {
  const relPaths: string[] = [];
  const rootEntries = readdirSync(root, { withFileTypes: true });

  for (const entry of rootEntries) {
    if (entry.isFile() && isDocFile(entry.name)) {
      relPaths.push(entry.name);
      continue;
    }
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      if (DOCS_DIR_NAMES.has(entry.name.toLowerCase())) {
        relPaths.push(...collectDocFiles(path.join(root, entry.name), entry.name));
      }
    }
  }

  const ignored = gitIgnoredPaths(root, relPaths);
  const docs: DiscoveredDoc[] = [];
  for (const relPath of relPaths) {
    if (ignored.has(relPath)) continue;
    const fullPath = path.join(root, relPath);
    if (!statSync(fullPath).isFile()) continue;
    const content = readFileSync(fullPath, "utf-8");
    if (content.trim().length < MIN_CONTENT_LENGTH) continue;
    docs.push({ path: relPath, content });
  }

  return docs;
}

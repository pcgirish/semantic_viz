import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { langForFile, parserFor } from "./grammars/registry.js";
import { walkPythonFile } from "./walk-python.js";
import { walkTypeScriptFile } from "./walk-typescript.js";
import type { FileFacts } from "./facts.js";
import { moduleQualname } from "./qualname.js";
import { shortHash } from "./hash.js";

const SKIP_DIRS = new Set(["__pycache__", ".git", ".scv", "node_modules", "dist"]);

function listFiles(root: string): string[] {
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
      } else {
        out.push(full);
      }
    }
  }
  return out.sort();
}

interface FileFactsCacheEntry {
  contentHash: string;
  facts: FileFacts;
}

function cacheFileFor(cacheDir: string, rel: string): string {
  return path.join(cacheDir, `${shortHash(rel)}.json`);
}

function readCachedFacts(cacheDir: string, rel: string, contentHash: string): FileFacts | undefined {
  const cacheFile = cacheFileFor(cacheDir, rel);
  if (!existsSync(cacheFile)) return undefined;
  try {
    const entry = JSON.parse(readFileSync(cacheFile, "utf-8")) as FileFactsCacheEntry;
    return entry.contentHash === contentHash ? entry.facts : undefined;
  } catch {
    return undefined;
  }
}

function writeCachedFacts(cacheDir: string, rel: string, contentHash: string, facts: FileFacts): void {
  mkdirSync(cacheDir, { recursive: true });
  const entry: FileFactsCacheEntry = { contentHash, facts };
  writeFileSync(cacheFileFor(cacheDir, rel), JSON.stringify(entry));
}

/**
 * Parses every source file under `root` into `FileFacts`. When `cacheDir` is given, each
 * file's facts are cached keyed by content hash (not sha-scoped — only file bytes matter),
 * so unchanged files are read from cache instead of re-parsed. Omit `cacheDir` for
 * standalone/test use with no filesystem side effects.
 */
export function parseRepoFiles(root: string, cacheDir?: string): FileFacts[] {
  const files = listFiles(root);
  const results: FileFacts[] = [];
  for (const abs of files) {
    const rel = path.relative(root, abs);
    const lang = langForFile(rel);
    if (!lang) continue;
    const src = readFileSync(abs, "utf-8");

    if (cacheDir) {
      const contentHash = shortHash(src);
      const cached = readCachedFacts(cacheDir, rel, contentHash);
      if (cached) {
        results.push(cached);
        continue;
      }
      const parser = parserFor(lang);
      const tree = parser.parse(src);
      const facts = lang === "python" ? walkPythonFile(tree, src, rel) : walkTypeScriptFile(tree, src, rel);
      const entry: FileFacts = { file: rel, lang, facts };
      writeCachedFacts(cacheDir, rel, contentHash, entry);
      results.push(entry);
      continue;
    }

    const parser = parserFor(lang);
    const tree = parser.parse(src);
    const facts = lang === "python" ? walkPythonFile(tree, src, rel) : walkTypeScriptFile(tree, src, rel);
    results.push({ file: rel, lang, facts });
  }
  return results;
}

export function knownModulesOf(files: FileFacts[]): Set<string> {
  return new Set(files.map((f) => moduleQualname(f.file)));
}

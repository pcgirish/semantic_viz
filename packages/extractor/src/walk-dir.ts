import { lstatSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { gitIgnoredPaths } from "./git-ignored.js";

const SKIP_DIRS = new Set(["__pycache__", ".git", ".scv", "node_modules", "dist"]);

/**
 * True when `target` resolves to `realRoot` itself or something beneath it. The target is
 * realpath'd so a link chain cannot smuggle a path past a plain string comparison, and the
 * separator suffix stops `/repo-secrets` from passing as a child of `/repo`.
 */
function escapesRoot(realRoot: string, target: string): boolean {
  const resolved = realpathSync(target);
  return resolved !== realRoot && !resolved.startsWith(realRoot + path.sep);
}

/**
 * Lists every file under `root`, sorted, skipping dotfiles, `SKIP_DIRS` and files git ignores.
 *
 * Symlinks are traversed only when their target stays inside `root`. An analyzed repo is
 * untrusted input: a link escaping the root would pull outside files into the unit set, whose
 * source is then sent verbatim to the provider on a remote run. `lstatSync` is what makes this
 * enforceable — `statSync` follows the link before we can decide, reporting a linked directory
 * as an ordinary one.
 *
 * Containment is judged against the realpath'd root, but the returned paths stay rooted at the
 * caller's `root` as given: callers derive repo-relative paths from it, and on macOS `root` is
 * routinely a symlink itself (`/tmp` → `/private/tmp`), so returning resolved paths would make
 * every result relative-escape its own repo.
 */
export function listFilesContained(root: string): string[] {
  const realRoot = realpathSync(root);
  const out: string[] = [];
  const stack: string[] = [root];
  // Real paths of directories already walked. A symlink pointing at its own ancestor is
  // contained, so containment alone does not stop it being followed; without this the walk
  // revisits the cycle until the OS gives up with ELOOP and extraction dies.
  const visited = new Set<string>([realRoot]);

  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);

      // A link whose target vanished, or that we cannot resolve, is simply not walked.
      let stat;
      try {
        stat = lstatSync(full);
        if (stat.isSymbolicLink()) {
          if (escapesRoot(realRoot, full)) continue;
          // Re-stat through the link so an in-repo link to a directory is still descended
          // into rather than being recorded as a file.
          stat = lstatSync(realpathSync(full));
        }
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        const realDir = realpathSync(full);
        if (visited.has(realDir)) continue;
        visited.add(realDir);
        stack.push(full);
      } else if (stat.isFile()) {
        out.push(full);
      }
    }
  }
  const toRel = (file: string) => path.relative(root, file).split(path.sep).join("/");
  const ignored = gitIgnoredPaths(root, out.map(toRel));
  return out.filter((file) => !ignored.has(toRel(file))).sort();
}

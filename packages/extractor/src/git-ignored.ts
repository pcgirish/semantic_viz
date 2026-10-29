import { spawnSync } from "node:child_process";

/**
 * The subset of `relPaths` (relative to `root`) that git ignores there. Ignored files exist in
 * a local worktree but never in a fresh clone, so analyzing them would make a committed
 * `.scv/semantics/` store disagree between a developer's machine and CI.
 *
 * Tracked files are never reported, even when an ignore rule matches them. Outside a git repo,
 * or where git is unavailable, there are no rules to apply and nothing is reported.
 */
export function gitIgnoredPaths(root: string, relPaths: readonly string[]): Set<string> {
  if (relPaths.length === 0) return new Set();
  const result = spawnSync("git", ["-C", root, "check-ignore", "--stdin", "-z"], {
    input: relPaths.map((rel) => `${rel}\0`).join(""),
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  // check-ignore exits 0 when some path is ignored, 1 when none is, 128 outside a repo.
  if (result.status !== 0) return new Set();
  return new Set(result.stdout.split("\0").filter((rel) => rel.length > 0));
}

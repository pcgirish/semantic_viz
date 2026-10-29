import { spawnSync } from "node:child_process";

/**
 * The subset of `relPaths` (relative to `root`) that git ignores there. Ignored files exist in
 * a local worktree but never in a fresh clone, so analyzing them would make a committed
 * `.scv/semantics/` store disagree between a developer's machine and CI.
 *
 * Tracked files are never reported, even when an ignore rule matches them. Outside a git repo,
 * or where git is unavailable, there are no rules to apply and nothing is reported; any other
 * git failure throws rather than silently analyzing ignored files.
 */
export function gitIgnoredPaths(root: string, relPaths: readonly string[]): Set<string> {
  if (relPaths.length === 0) return new Set();
  const result = spawnSync("git", ["-C", root, "check-ignore", "--stdin", "-z"], {
    input: relPaths.map((rel) => `${rel}\0`).join(""),
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, LC_ALL: "C" },
  });
  // check-ignore exits 0 when some path is ignored, 1 when none is, 128 on a fatal error —
  // only "not a git repository" among those means there are no rules to apply.
  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw result.error;
  }
  if (result.status === 1) return new Set();
  if (result.status !== 0) {
    if (/not a git repository/i.test(result.stderr)) return new Set();
    throw new Error(`git check-ignore failed in ${root}: ${result.stderr.trim()}`);
  }
  return new Set(result.stdout.split("\0").filter((rel) => rel.length > 0));
}

import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

/**
 * Runs `use` against a checkout of `sha`: the repo itself when `sha` is HEAD and the worktree is
 * clean, else a private detached worktree that is removed afterwards, whether `use` succeeds or
 * throws.
 */
export async function withCheckout<T>(root: string, sha: string, use: (dir: string) => Promise<T> | T): Promise<T> {
  const head = git(root, ["rev-parse", "--verify", "HEAD"]).trim();
  if (head === sha && git(root, ["status", "--porcelain", "--untracked-files=all"]) === "") return use(root);

  const dir = mkdtempSync(path.join(realpathSync(tmpdir()), "scv-checkout-"));
  try {
    git(root, ["worktree", "add", "--detach", "--quiet", dir, sha]);
    return await use(dir);
  } finally {
    spawnSync("git", ["worktree", "remove", "--force", dir], { cwd: root });
    rmSync(dir, { recursive: true, force: true });
    spawnSync("git", ["worktree", "prune"], { cwd: root });
  }
}

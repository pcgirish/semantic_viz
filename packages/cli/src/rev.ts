import { spawnSync } from "node:child_process";

export interface HeadRev {
  sha: string;
  kind: "commit";
  ts: string;
  author: string;
  author_kind: "human";
}

/** Reads HEAD's sha, author, and commit timestamp via `git log -1`. */
export function headRev(root: string): HeadRev {
  return commitRev(root, "HEAD");
}

/**
 * Resolves `rev` (a sha, branch, tag or `HEAD~n`) to a commit and reads its sha, author and
 * timestamp. Git gets argument arrays, never a shell, and a rev starting with `-` is refused so
 * it can never be read as an option.
 */
export function commitRev(root: string, rev: string): HeadRev {
  if (rev.length === 0 || rev.startsWith("-")) throw new Error(`invalid revision ${JSON.stringify(rev)}`);
  const result = spawnSync("git", ["log", "-1", "--no-walk", "--format=%H|%an|%aI", `${rev}^{commit}`, "--"], { cwd: root, encoding: "utf-8" });
  if (result.status !== 0 || !result.stdout) {
    throw new Error(`failed to read ${rev} rev for ${root}: ${result.stderr || "not a git repository"}`);
  }
  const [sha, author, ts] = result.stdout.trim().split("|");
  if (!sha || !author || !ts) {
    throw new Error(`unexpected git log output for ${root}: ${result.stdout}`);
  }
  return { sha, kind: "commit", author, author_kind: "human", ts };
}

/** How far back to look for a cached predecessor analysis. Far enough to cross a normal stretch
 *  of unanalyzed commits, short enough that a long history never turns startup into a git walk. */
export const ANCESTOR_WALK_LIMIT = 50;

/**
 * First-parent ancestors of HEAD, nearest first, excluding HEAD. Used to find the nearest
 * previous analysis whose layers can be carried over.
 *
 * First-parent only: on a merge, the side the branch actually continued is the one whose layer
 * names a reader remembers. Never throws — no git, a shallow clone, or an unborn branch just
 * means no predecessor, and a missing carry-over costs some Pass C calls, not correctness.
 */
export function ancestorShas(root: string): string[] {
  const result = spawnSync("git", ["rev-list", "--first-parent", `--max-count=${ANCESTOR_WALK_LIMIT + 1}`, "HEAD"], {
    cwd: root,
    encoding: "utf-8",
  });
  if (result.status !== 0 || !result.stdout) return [];
  return result.stdout.trim().split("\n").filter(Boolean).slice(1);
}

/** Files changed in HEAD's most recent commit (`git diff --name-only HEAD~1 HEAD`), repo-root
 *  relative. Empty on any git failure (no history, unborn branch, not a repo) — same
 *  never-throws convention as `ancestorShas`. */
export function changedFiles(root: string): string[] {
  const result = spawnSync("git", ["diff", "--name-only", "HEAD~1", "HEAD"], { cwd: root, encoding: "utf-8" });
  if (result.status !== 0 || !result.stdout) return [];
  return result.stdout.trim().split("\n").filter(Boolean);
}

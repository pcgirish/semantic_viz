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
  const result = spawnSync("git", ["log", "-1", "--format=%H|%an|%aI"], { cwd: root, encoding: "utf-8" });
  if (result.status !== 0 || !result.stdout) {
    throw new Error(`failed to read HEAD rev for ${root}: ${result.stderr || "not a git repository"}`);
  }
  const [sha, author, ts] = result.stdout.trim().split("|");
  if (!sha || !author || !ts) {
    throw new Error(`unexpected git log output for ${root}: ${result.stdout}`);
  }
  return { sha, kind: "commit", author, author_kind: "human", ts };
}

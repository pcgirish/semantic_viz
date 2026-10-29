import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PendingSemantics } from "@scv/schema";
import { runMergeSemantics, type RunMergeSemanticsOptions } from "../src/merge-semantics.js";

/** A throwaway git repository with its `.scv` dir kept outside it, so the worktree stays clean. */
export interface GitFixture {
  root: string;
  scvDir: string;
  git(...args: string[]): string;
  write(file: string, content: string): void;
  commit(message: string): string;
  cleanup(): void;
}

/** Seeds the repo from `files`, or from a copy of `copyFrom` without its `.git`/`.scv`. */
export function gitFixture(seed: { files: Record<string, string> } | { copyFrom: string }): GitFixture {
  const base = mkdtempSync(path.join(tmpdir(), "scv-git-"));
  const root = path.join(base, "repo");
  const scvDir = path.join(base, "scv");
  mkdirSync(root);

  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf-8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const write = (file: string, content: string) => {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  };
  const commit = (message: string) => {
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", message);
    return git("rev-parse", "HEAD");
  };

  if ("copyFrom" in seed) {
    const skipped = new Set([".git", ".scv"]);
    cpSync(seed.copyFrom, root, { recursive: true, filter: (src) => !skipped.has(path.basename(src)) });
  } else {
    for (const [file, content] of Object.entries(seed.files)) write(file, content);
  }
  git("init", "-q", "-b", "main");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  git("config", "commit.gpgsign", "false");
  commit("initial");
  return { root, scvDir, git, write, commit, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

export function pendingOf(partial: Partial<PendingSemantics>): PendingSemantics {
  return { units: {}, layers: {}, groups: {}, flows: {}, docs: {}, ...partial };
}

export const narration = (what: string) => ({ what, how: "h", when: "n", where: "r", why: "y", confidence: 1 });

/** Runs `scv merge-semantics` against the fixture with an in-memory pending set. */
export async function mergeInto(fx: GitFixture, pending: Partial<PendingSemantics>, flags: Omit<RunMergeSemanticsOptions, "root" | "pendingFile" | "scvDir"> = {}) {
  const pendingFile = path.join(path.dirname(fx.scvDir), "pending.json");
  writeFileSync(pendingFile, JSON.stringify(pendingOf(pending)));
  return runMergeSemantics({ root: fx.root, scvDir: fx.scvDir, pendingFile, ...flags });
}

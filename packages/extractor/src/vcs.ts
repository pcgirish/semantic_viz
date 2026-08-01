import { spawnSync } from "node:child_process";

export interface FileChurn {
  commits: number;
  added: number;
  deleted: number;
  authors: Map<string, number>;
}

/** Per-file churn, commit count, and per-author added-line counts, from `git log --numstat`. */
export function churnByFile(root: string): Map<string, FileChurn> {
  const result = spawnSync("git", ["log", "--format=%H|%an", "--numstat"], { cwd: root, encoding: "utf-8" });
  const churn = new Map<string, FileChurn>();
  if (result.status !== 0 || !result.stdout) return churn;

  let author: string | null = null;
  for (const line of result.stdout.split("\n")) {
    if (line.includes("|") && !line.includes("\t")) {
      const [, an] = line.split("|", 2);
      author = an ?? null;
    } else if (line.includes("\t")) {
      const [addStr, deleteStr, file] = line.split("\t");
      if (addStr === "-" || !file) continue;
      const added = Number(addStr);
      const deleted = Number(deleteStr);
      const entry = churn.get(file) ?? { commits: 0, added: 0, deleted: 0, authors: new Map<string, number>() };
      entry.commits += 1;
      entry.added += added;
      entry.deleted += deleted;
      if (author) entry.authors.set(author, (entry.authors.get(author) ?? 0) + added);
      churn.set(file, entry);
    }
  }
  return churn;
}

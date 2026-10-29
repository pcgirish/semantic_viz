// Provisions the nested fixture repos the test suite reads. fixtures/orderly is its own git repo
// (tests read its history: churn, ancestors, HEAD), so it is gitignored and shipped as a git
// bundle of its main branch; a fresh clone gets it from that bundle before `npm run test`.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Clones `bundle`'s main branch into `dest` unless a checkout is already there. */
export function ensureFixture(bundle, dest) {
  if (existsSync(path.join(dest, ".git"))) return "present";
  const result = spawnSync("git", ["clone", "-q", "-b", "main", bundle, dest], { encoding: "utf-8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git clone ${bundle} failed: ${result.stderr.trim()}`);
  return "cloned";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));
  const outcome = ensureFixture(path.join(fixtures, "orderly.bundle"), path.join(fixtures, "orderly"));
  if (outcome === "cloned") console.log("fixtures/orderly cloned from fixtures/orderly.bundle");
}

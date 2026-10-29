import path from "node:path";
import { extractRepo, isTestPath } from "@semviz/extractor";
import { canonicalJson } from "./artifacts.js";
import { git, withCheckout } from "./checkout.js";
import { discoverDocs } from "./discover-docs.js";
import { authoredFromStore, emptyAuthoredSet, evaluate, functionFingerprints, type AuthoredSet, type Choice } from "./fingerprints.js";
import { commitRev, headRev } from "./rev.js";
import { readStoreFromDisk, readStoreFromGit, storeDirIn } from "./semantics-store.js";
import { toSnapshot } from "./snapshot.js";

export type CheckStatus = "stale" | "missing" | "orphaned";
export type CheckKind = "function" | "docs" | "layers" | "groups" | "flows";

export interface CheckItem {
  status: CheckStatus;
  kind: CheckKind;
  /** Unit id, doc path, or the global artifact's store file. */
  id: string;
  /** Source file of a function/class unit. */
  file?: string;
  /** The agent skill that re-authors this item. */
  skill: string;
}

export interface CheckOptions {
  root: string;
  /** Limits function-level findings to units whose fingerprint inputs changed since `git merge-base <base> HEAD`. */
  base?: string;
  scvDir?: string;
}

export interface CheckResult {
  ok: boolean;
  base?: { ref: string; sha: string; mergeBase: string };
  items: CheckItem[];
}

const SKILLS: Record<CheckKind, string> = {
  function: "agent-analyze-functions",
  docs: "agent-analyze-docs",
  layers: "agent-analyze-layers",
  groups: "agent-analyze-groups",
  flows: "agent-analyze-flows",
};

const item = (status: CheckStatus, kind: CheckKind, id: string, file?: string): CheckItem =>
  file === undefined ? { status, kind, id, skill: SKILLS[kind] } : { status, kind, id, file, skill: SKILLS[kind] };

/** stale when committed against other inputs; missing when nothing is committed and `expected`. */
function statusOf(choice: Choice<unknown>, expected: boolean): CheckStatus | undefined {
  if (choice.store) return choice.storeFresh ? undefined : "stale";
  return expected ? "missing" : undefined;
}

/** Each function's fingerprint and committed entry at the merge base. */
interface BaseState {
  fingerprints: Map<string, string>;
  store: AuthoredSet;
}

async function baseState(root: string, scvDir: string, mergeBase: string): Promise<BaseState> {
  const graph = await withCheckout(root, mergeBase, (checkout) => extractRepo(checkout, path.join(scvDir, "artifacts", "extraction-files")));
  const store = authoredFromStore(readStoreFromGit(root, mergeBase));
  return { fingerprints: functionFingerprints(graph, (id) => store.functions[id]?.entry), store };
}

/**
 * `scv check [--base <ref>]`: recomputes every fingerprint for the working tree against the
 * committed store `.scv/semantics/` and lists what must be re-authored — stale entries, expected
 * entries that are missing, and entries whose unit or doc no longer exists. With a base, function
 * findings are limited to units whose fingerprint or committed entry changed since the merge base
 * (so a caller made stale through the call chain is reported even outside the diff); docs and
 * global artifacts are always checked.
 */
export async function runCheck(options: CheckOptions): Promise<CheckResult> {
  const { root } = options;
  const scvDir = options.scvDir ?? path.join(root, ".scv");
  let base: CheckResult["base"];
  let atBase: BaseState | undefined;
  if (options.base !== undefined) {
    let sha: string;
    try {
      sha = commitRev(root, options.base).sha;
    } catch (error) {
      throw new Error(`cannot resolve --base ${JSON.stringify(options.base)}: ${(error as Error).message}`);
    }
    const mergeBase = git(root, ["merge-base", sha, "HEAD"]).trim();
    base = { ref: options.base, sha, mergeBase };
    atBase = await baseState(root, scvDir, mergeBase);
  }

  const rev = headRev(root);
  const graph = extractRepo(root, path.join(scvDir, "artifacts", "extraction-files"));
  const docs = discoverDocs(root);
  const committed = readStoreFromDisk(storeDirIn(root));
  const store = authoredFromStore(committed);
  const ev = evaluate({ graph, snapshot: toSnapshot(graph, { root, rev }), docs }, emptyAuthoredSet(), store);

  // A function finding is in scope unless its fingerprint and committed entry are as at the base.
  const changedSinceBase = (id: string, fingerprint: string | undefined) =>
    !atBase || atBase.fingerprints.get(id) !== fingerprint || canonicalJson(atBase.store.functions[id] ?? null) !== canonicalJson(store.functions[id] ?? null);

  const items: CheckItem[] = [];
  const unitById = new Map(graph.units.map((u) => [u.id, u]));
  for (const [id, choice] of [...ev.functions].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const file = unitById.get(id)!.loc.file;
    const status = statusOf(choice, !isTestPath(file));
    if (status && changedSinceBase(id, choice.fingerprint)) items.push(item(status, "function", id, file));
  }
  const fileOfStored = new Map(Object.entries(committed.functions).flatMap(([file, units]) => Object.keys(units).map((id) => [id, file] as const)));
  for (const id of Object.keys(store.functions).sort()) {
    if (ev.functions.has(id)) continue;
    const preexisting = atBase !== undefined && atBase.store.functions[id] !== undefined && !atBase.fingerprints.has(id);
    if (!preexisting) items.push(item("orphaned", "function", id, fileOfStored.get(id)));
  }

  for (const [docPath, choice] of ev.docs) {
    const status = statusOf(choice, true);
    if (status) items.push(item(status, "docs", docPath));
  }
  for (const docPath of Object.keys(store.docs).sort()) {
    if (!ev.docs.has(docPath)) items.push(item("orphaned", "docs", docPath));
  }

  for (const kind of ["layers", "groups", "flows"] as const) {
    const status = statusOf(ev[kind], ev.clustered);
    if (status) items.push(item(status, kind, `${kind}.json`));
  }

  return { ok: items.length === 0, ...(base && { base }), items };
}

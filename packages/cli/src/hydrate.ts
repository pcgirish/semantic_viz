import path from "node:path";
import { extractRepo } from "@semviz/extractor";
import type { PendingSemantics } from "@semviz/schema";
import type { ArtifactName } from "./artifacts.js";
import { assembleSnapshotFromCache } from "./assemble-snapshot.js";
import { withCheckout } from "./checkout.js";
import { discoverDocs } from "./discover-docs.js";
import { authoredFromStore, emptyAuthoredSet, evaluate, type Evaluation } from "./fingerprints.js";
import { mergeSemantics, noLlmContext } from "./merge-semantics.js";
import { commitRev, type HeadRev } from "./rev.js";
import { readStoreFromGit, type StoreContents } from "./semantics-store.js";
import { toSnapshot } from "./snapshot.js";

export interface HydrateOptions {
  root: string;
  /** Any commit-ish; defaults to `HEAD`. */
  rev?: string;
  scvDir?: string;
}

export interface HydrateResult {
  sha: string;
  merged: number;
  skipped: number;
  /** Committed entries left out because their stamp does not match that revision's inputs. */
  stale: number;
  warnings: string[];
  path: string;
  emptyArtifacts: ArtifactName[];
}

/** The fresh committed entries as a pending set, plus how many committed entries were stale. */
function freshPending(ev: Evaluation): { pending: PendingSemantics; stale: number } {
  const pending: PendingSemantics = { units: {}, layers: {}, groups: {}, flows: {}, docs: {} };
  let stale = 0;
  for (const [id, choice] of ev.functions) {
    if (choice.storeFresh) pending.units[id] = choice.store!.entry;
    else if (choice.store) stale++;
  }
  for (const [docPath, choice] of ev.docs) {
    if (choice.storeFresh) pending.docs[docPath] = choice.store!.entry;
    else if (choice.store) stale++;
  }
  for (const [key, choice] of [["layers", ev.layers], ["groups", ev.groups], ["flows", ev.flows]] as const) {
    if (choice.storeFresh) Object.assign(pending[key], choice.store!.entry);
    else if (choice.store) stale++;
  }
  return { pending, stale };
}

/**
 * `scv hydrate [rev]`: seeds `.scv/artifacts/<sha>/` with every entry committed in
 * `.scv/semantics/` at `rev` that is still fresh against that revision's own structure. The
 * structure always comes from a live extraction of that revision, never a persisted snapshot.
 */
export async function runHydrate(options: HydrateOptions): Promise<HydrateResult> {
  const { root } = options;
  const scvDir = options.scvDir ?? path.join(root, ".scv");
  const rev: HeadRev = commitRev(root, options.rev ?? "HEAD");

  return withCheckout(root, rev.sha, async (checkout) => {
    const graph = extractRepo(checkout, path.join(scvDir, "artifacts", "extraction-files"));
    const snapshot = toSnapshot(graph, { root: checkout, rev, repoName: path.basename(root) });
    const docs = discoverDocs(checkout);
    const committedStore: StoreContents = readStoreFromGit(root, rev.sha);
    const ev = evaluate({ graph, snapshot, docs }, emptyAuthoredSet(), authoredFromStore(committedStore));
    const { pending, stale } = freshPending(ev);

    const ctx = noLlmContext({ scvDir, sha: rev.sha, snapshot, graph, docs });
    const result = await mergeSemantics({
      ctx,
      root: checkout,
      pending,
      committedStore,
      withDocs: Object.keys(pending.docs).length > 0,
      withClustering: ev.layers.storeFresh,
      withGroups: ev.layers.storeFresh && ev.groups.storeFresh,
      withFlows: ev.flows.storeFresh,
    });
    const assembled = await assembleSnapshotFromCache({ ctx, rev, scvDir });
    return { sha: rev.sha, ...result, stale, path: assembled.path, emptyArtifacts: assembled.emptyArtifacts };
  });
}

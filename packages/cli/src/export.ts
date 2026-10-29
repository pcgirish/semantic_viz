import path from "node:path";
import { extractRepo } from "@semviz/extractor";
import { readAuthoredRecord } from "./authored-record.js";
import { discoverDocs } from "./discover-docs.js";
import { authoredFromStore, evaluate, type Choice } from "./fingerprints.js";
import { headRev } from "./rev.js";
import { emptyStore, readStoreFromDisk, storeDirIn, writeStore } from "./semantics-store.js";
import { toSnapshot } from "./snapshot.js";

export interface ExportOptions {
  root: string;
  scvDir?: string;
}

export interface ExportResult {
  dir: string;
  /** Function/class entries in the store after export. */
  functions: number;
  docs: number;
  /** Store entries kept as they were because their stamp no longer matches the current inputs. */
  stale: number;
}

/**
 * The entry export publishes for one item: a fresh authored entry with its merge-time stamp, else
 * the committed entry exactly as it is (fresh or stale). A stamp is never minted here.
 */
function published<T>(choice: Choice<T>): { fingerprint: string; entry: T; stale: boolean } | undefined {
  if (choice.primary !== undefined) return { fingerprint: choice.fingerprint, entry: choice.primary, stale: false };
  if (choice.store) return { ...choice.store, stale: !choice.storeFresh };
  return undefined;
}

/**
 * `scv export`: merges the entries authored at HEAD (the local authoring record) into the
 * committed store `.scv/semantics/`, then rewrites it atomically. Items are enumerated from the
 * current extraction and docs, so entries whose unit or doc no longer exists are pruned.
 */
export function runExport(options: ExportOptions): ExportResult {
  const { root } = options;
  const dir = storeDirIn(root);
  const scvDir = options.scvDir ?? path.join(root, ".scv");
  const rev = headRev(root);
  const graph = extractRepo(root, path.join(scvDir, "artifacts", "extraction-files"));
  const inputs = { graph, snapshot: toSnapshot(graph, { root, rev }), docs: discoverDocs(root) };
  const ev = evaluate(inputs, readAuthoredRecord(scvDir, rev.sha), authoredFromStore(readStoreFromDisk(dir)));

  const store = emptyStore();
  let functions = 0;
  let stale = 0;
  const fileOf = new Map(graph.units.map((u) => [u.id, u.loc.file]));
  for (const [id, choice] of ev.functions) {
    const item = published(choice);
    if (!item) continue;
    const file = fileOf.get(id)!;
    (store.functions[file] ??= {})[id] = { ...item.entry, fingerprint: item.fingerprint };
    functions++;
    if (item.stale) stale++;
  }

  let docs = 0;
  for (const [docPath, choice] of ev.docs) {
    const item = published(choice);
    if (!item) continue;
    store.docs[docPath] = { ...item.entry, fingerprint: item.fingerprint };
    docs++;
    if (item.stale) stale++;
  }

  const layers = published(ev.layers);
  if (layers) store.layers = { fingerprint: layers.fingerprint, layers: layers.entry };
  const groups = published(ev.groups);
  if (groups) store.groups = { fingerprint: groups.fingerprint, groups: groups.entry };
  const flows = published(ev.flows);
  if (flows) store.flows = { fingerprint: flows.fingerprint, flows: flows.entry };
  stale += [layers, groups, flows].filter((item) => item?.stale).length;

  writeStore(dir, store);
  return { dir, functions, docs, stale };
}

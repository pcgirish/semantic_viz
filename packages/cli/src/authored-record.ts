import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PendingDocSchema, PendingFlowSchema, PendingGroupSchema, PendingLayerSchema, PendingUnitSchema, type PendingUnit } from "@semviz/schema";
import { z } from "zod";
import { canonicalJson } from "./artifacts.js";
import { emptyAuthoredSet, evaluate, type AuthoredSet, type Choice, type FingerprintInputs, type Stamped } from "./fingerprints.js";

/**
 * The local authoring record, `.scv/artifacts/<sha>/authored.json`: every entry `merge-semantics`
 * has merged at this sha, stamped with the fingerprint of the inputs current when it was merged.
 * `scv export` publishes only entries whose stamp still matches, so a stamp is never minted at
 * export time.
 */
export const RECORD_VERSION = 1;

const FingerprintSchema = z.string().regex(/^[0-9a-f]{40}$/);
const stamped = <S extends z.ZodTypeAny>(entry: S) => z.object({ fingerprint: FingerprintSchema, entry }).strict();

const RecordSchema = z
  .object({
    recordVersion: z.literal(RECORD_VERSION),
    functions: z.record(z.string(), stamped(PendingUnitSchema.strict())),
    docs: z.record(z.string(), stamped(PendingDocSchema.strict())),
    layers: stamped(z.record(z.string(), PendingLayerSchema.strict())).optional(),
    groups: stamped(z.record(z.string(), PendingGroupSchema.strict())).optional(),
    flows: stamped(z.record(z.string(), PendingFlowSchema.strict())).optional(),
  })
  .strict();

function recordFile(scvDir: string, sha: string): string {
  return path.join(scvDir, "artifacts", sha, "authored.json");
}

export function readAuthoredRecord(scvDir: string, sha: string): AuthoredSet {
  const file = recordFile(scvDir, sha);
  if (!existsSync(file)) return emptyAuthoredSet();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    throw new Error(`${file}: invalid JSON`);
  }
  const recordVersion = (raw as { recordVersion?: unknown } | null)?.recordVersion;
  if (recordVersion !== RECORD_VERSION) throw new Error(`${file}: unsupported recordVersion ${JSON.stringify(recordVersion)}`);
  const parsed = RecordSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${file}: ${parsed.error.message}`);
  const { functions, docs, layers, groups, flows } = parsed.data;
  return { functions, docs, layers, groups, flows };
}

function isEmpty(record: AuthoredSet): boolean {
  return Object.keys(record.functions).length === 0 && Object.keys(record.docs).length === 0 && !record.layers && !record.groups && !record.flows;
}

/** Atomic and write-if-changed; an empty record with no file on disk stays absent. */
export function writeAuthoredRecord(scvDir: string, sha: string, record: AuthoredSet): void {
  const file = recordFile(scvDir, sha);
  const exists = existsSync(file);
  if (!exists && isEmpty(record)) return;
  const text = canonicalJson({ recordVersion: RECORD_VERSION, ...record });
  if (exists && readFileSync(file, "utf-8") === text) return;
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, file);
}

/** The entry a re-author builds on: a fresh record entry, else a fresh store entry, else none. */
function freshView<T>(choice: Choice<T> | undefined): T | undefined {
  return choice?.primary ?? (choice?.storeFresh ? choice.store?.entry : undefined);
}

/** A partial re-author (e.g. block labels only) keeps the other fields of the fresh entry. */
function layerOver(base: PendingUnit | undefined, now: PendingUnit): PendingUnit {
  if (!base || base.kind !== now.kind) return now;
  const defined = Object.fromEntries(Object.entries(now).filter(([, v]) => v !== undefined)) as PendingUnit;
  const combined: PendingUnit = { ...base, ...defined };
  if (base.blockLabels && now.blockLabels) combined.blockLabels = { ...base.blockLabels, ...now.blockLabels };
  return combined;
}

/**
 * Folds the entries merged in this run (`now`, unstamped) into the prior record and stamps them
 * with the fingerprints of the current inputs. Prior entries keep the stamp they were merged with
 * — re-authoring a callee makes a caller stale, it never re-stamps it. Entries whose unit or doc
 * no longer exists are dropped. `store` is the committed store, read for the committed view of
 * callees the record does not cover.
 */
export function stampAuthored(inputs: FingerprintInputs, prior: AuthoredSet, now: AuthoredSet, store: AuthoredSet): AuthoredSet {
  const before = evaluate(inputs, prior, store);
  const primary: AuthoredSet = {
    functions: { ...prior.functions },
    docs: { ...prior.docs, ...now.docs },
    layers: now.layers ?? prior.layers,
    groups: now.groups ?? prior.groups,
    flows: now.flows ?? prior.flows,
  };
  for (const [id, { entry }] of Object.entries(now.functions)) {
    primary.functions[id] = { entry: layerOver(freshView(before.functions.get(id)), entry) };
  }
  const after = evaluate(inputs, primary, store);

  const stampFrom = <T>(item: Stamped<T>, fingerprint: string | undefined): Stamped<T> | undefined =>
    fingerprint === undefined ? undefined : { fingerprint: item.fingerprint ?? fingerprint, entry: item.entry };
  const record = emptyAuthoredSet();
  for (const [id, item] of Object.entries(primary.functions)) {
    const stampedItem = stampFrom(item, after.functions.get(id)?.fingerprint);
    if (stampedItem) record.functions[id] = stampedItem;
  }
  for (const [docPath, item] of Object.entries(primary.docs)) {
    const stampedItem = stampFrom(item, after.docs.get(docPath)?.fingerprint);
    if (stampedItem) record.docs[docPath] = stampedItem;
  }
  if (primary.layers) record.layers = stampFrom(primary.layers, after.layers.fingerprint);
  if (primary.groups) record.groups = stampFrom(primary.groups, after.groups.fingerprint);
  if (primary.flows) record.flows = stampFrom(primary.flows, after.flows.fingerprint);
  return record;
}

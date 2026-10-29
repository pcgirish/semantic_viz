import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PendingDocSchema, PendingFlowSchema, PendingGroupSchema, PendingLayerSchema, PendingUnitSchema } from "@scv/schema";
import { z } from "zod";
import { sortKeys } from "./artifacts.js";

/**
 * The committed semantics store, `.scv/semantics/`: authored narration keyed by unit id (never
 * by commit sha) so it survives commits and can be published with the repo. Each entry carries
 * the fingerprint of the inputs it was authored against; `scv hydrate` uses it to decide freshness.
 */
export const STORE_VERSION = 1;

/** Path of the store relative to the repo root. */
export const STORE_REL_DIR = ".scv/semantics";

const FUNCTIONS_DIR = "functions";
const MAX_SHARD_NAME = 240;

const FingerprintSchema = z.string().regex(/^[0-9a-f]{40}$/);
const version = z.literal(STORE_VERSION);

const StoredUnitSchema = PendingUnitSchema.extend({ fingerprint: FingerprintSchema }).strict();
const StoredDocSchema = PendingDocSchema.extend({ fingerprint: FingerprintSchema }).strict();
const StoredLayerSchema = PendingLayerSchema.strict();
const StoredGroupSchema = PendingGroupSchema.strict();
const StoredFlowSchema = PendingFlowSchema.strict();

const FunctionShardSchema = z.object({ storeVersion: version, file: z.string(), units: z.record(z.string(), StoredUnitSchema) }).strict();
const DocsFileSchema = z.object({ storeVersion: version, docs: z.record(z.string(), StoredDocSchema) }).strict();
const LayersFileSchema = z
  .object({ storeVersion: version, fingerprint: FingerprintSchema, layers: z.record(z.string(), StoredLayerSchema) })
  .strict();
const GroupsFileSchema = z
  .object({ storeVersion: version, fingerprint: FingerprintSchema, groups: z.record(z.string(), StoredGroupSchema) })
  .strict();
const FlowsFileSchema = z
  .object({ storeVersion: version, fingerprint: FingerprintSchema, flows: z.record(z.string(), StoredFlowSchema) })
  .strict();

export type StoredUnit = z.infer<typeof StoredUnitSchema>;
export type StoredDoc = z.infer<typeof StoredDocSchema>;
export type StoredLayer = z.infer<typeof StoredLayerSchema>;
export type StoredGroup = z.infer<typeof StoredGroupSchema>;
export type StoredFlow = z.infer<typeof StoredFlowSchema>;

export interface StoreContents {
  /** Source file → unit id → entry. */
  functions: Record<string, Record<string, StoredUnit>>;
  /** Doc path → entry. */
  docs: Record<string, StoredDoc>;
  layers?: { fingerprint: string; layers: Record<string, StoredLayer> };
  groups?: { fingerprint: string; groups: Record<string, StoredGroup> };
  flows?: { fingerprint: string; flows: Record<string, StoredFlow> };
}

/**
 * The store directory under `root`, refusing one that resolves outside it. Symlinks are
 * resolved; a store not yet created is judged by its nearest existing ancestor, and a dangling
 * link on the way is refused rather than followed.
 */
export function storeDirIn(root: string): string {
  const realRoot = realpathSync(root);
  const target = path.join(root, STORE_REL_DIR);
  let existing = target;
  while (!lstatSync(existing, { throwIfNoEntry: false })) existing = path.dirname(existing);
  let real: string;
  try {
    real = realpathSync(existing);
  } catch {
    throw new Error(`${path.relative(root, existing)} is a dangling link; refusing to write ${STORE_REL_DIR}`);
  }
  if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`${STORE_REL_DIR} resolves outside ${root}`);
  }
  return target;
}

export function emptyStore(): StoreContents {
  return { functions: {}, docs: {} };
}

/** Rejects anything but a relative POSIX path that stays inside the repo. */
function assertRepoRelativePath(file: string): void {
  const segments = file.split("/");
  if (file.length === 0 || file.includes("\0") || file.startsWith("/") || segments.some((s) => s === "" || s === "." || s === "..")) {
    throw new Error(`invalid source path for semantics store: ${JSON.stringify(file)}`);
  }
}

const KEPT_CHAR = /^[a-z0-9._-]$/;

/**
 * Maps a repo-relative source path to one shard file name. Only `[a-z0-9._-]` pass through;
 * every other UTF-8 byte (including `/` and uppercase letters) becomes `%XX`, so names never
 * contain a separator and never collide on case-insensitive file systems.
 */
export function encodeShardName(file: string): string {
  assertRepoRelativePath(file);
  let encoded = "";
  for (const char of file) {
    if (KEPT_CHAR.test(char)) {
      encoded += char;
      continue;
    }
    for (const byte of Buffer.from(char, "utf-8")) encoded += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  const name = `${encoded}.json`;
  if (name.length > MAX_SHARD_NAME) throw new Error(`source path too long for semantics store: ${file}`);
  return name;
}

const SHARD_NAME = /^(?:[a-z0-9._-]|%[0-9A-F]{2})+\.json$/;

/** Inverse of `encodeShardName`; accepts only the canonical encoding of a valid source path. */
export function decodeShardName(name: string): string {
  if (!SHARD_NAME.test(name)) throw new Error(`invalid semantics shard name: ${name}`);
  const body = name.slice(0, -".json".length);
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "%") {
      bytes.push(Number.parseInt(body.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(body.charCodeAt(i));
    }
  }
  let file: string;
  try {
    file = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    throw new Error(`invalid semantics shard name: ${name}`);
  }
  if (encodeShardName(file) !== name) throw new Error(`non-canonical semantics shard name: ${name}`);
  return file;
}

function parseStoreFile<S extends z.ZodTypeAny>(rel: string, text: string, schema: S): z.infer<S> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${rel}: invalid JSON`);
  }
  const storeVersion = (raw as { storeVersion?: unknown } | null)?.storeVersion;
  if (storeVersion !== STORE_VERSION) throw new Error(`${rel}: unsupported storeVersion ${JSON.stringify(storeVersion)}`);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error(`${rel}: ${parsed.error.message}`);
  return parsed.data;
}

/** Parses store files keyed by path relative to the store root. Unknown paths are rejected. */
function parseStore(files: Map<string, string>): StoreContents {
  const store = emptyStore();
  for (const [rel, text] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    if (rel.startsWith(`${FUNCTIONS_DIR}/`)) {
      const name = rel.slice(FUNCTIONS_DIR.length + 1);
      const file = decodeShardName(name);
      const shard = parseStoreFile(rel, text, FunctionShardSchema);
      if (shard.file !== file) throw new Error(`${rel}: records file ${shard.file}, expected ${file}`);
      store.functions[file] = shard.units;
      continue;
    }
    switch (rel) {
      case "docs.json": {
        const { docs } = parseStoreFile(rel, text, DocsFileSchema);
        for (const [key, doc] of Object.entries(docs)) {
          if (doc.path !== key) throw new Error(`${rel}: entry ${key} records path ${doc.path}`);
        }
        store.docs = docs;
        break;
      }
      case "layers.json": {
        const { fingerprint, layers } = parseStoreFile(rel, text, LayersFileSchema);
        store.layers = { fingerprint, layers };
        break;
      }
      case "groups.json": {
        const { fingerprint, groups } = parseStoreFile(rel, text, GroupsFileSchema);
        store.groups = { fingerprint, groups };
        break;
      }
      case "flows.json": {
        const { fingerprint, flows } = parseStoreFile(rel, text, FlowsFileSchema);
        store.flows = { fingerprint, flows };
        break;
      }
      default:
        throw new Error(`unexpected file in semantics store: ${rel}`);
    }
  }
  return store;
}

function renderJson(value: unknown): string {
  return `${JSON.stringify(value, sortKeys, 2)}\n`;
}

function renderStore(store: StoreContents): Map<string, string> {
  const files = new Map<string, string>();
  for (const [file, units] of Object.entries(store.functions)) {
    if (Object.keys(units).length === 0) continue;
    files.set(`${FUNCTIONS_DIR}/${encodeShardName(file)}`, renderJson({ storeVersion: STORE_VERSION, file, units }));
  }
  if (Object.keys(store.docs).length > 0) files.set("docs.json", renderJson({ storeVersion: STORE_VERSION, docs: store.docs }));
  if (store.layers) files.set("layers.json", renderJson({ storeVersion: STORE_VERSION, ...store.layers }));
  if (store.groups) files.set("groups.json", renderJson({ storeVersion: STORE_VERSION, ...store.groups }));
  if (store.flows) files.set("flows.json", renderJson({ storeVersion: STORE_VERSION, ...store.flows }));
  return files;
}

function assertInside(realRoot: string, target: string, semanticsDir: string): void {
  const real = realpathSync(target);
  if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`${path.relative(semanticsDir, target)} resolves outside ${semanticsDir}`);
  }
}

/** Reads raw store files from disk, refusing any entry that resolves outside the store. */
function readRawFromDisk(semanticsDir: string): Map<string, string> {
  const files = new Map<string, string>();
  if (!existsSync(semanticsDir)) return files;
  const realRoot = realpathSync(semanticsDir);
  for (const entry of readdirSync(semanticsDir)) {
    const full = path.join(semanticsDir, entry);
    assertInside(realRoot, full, semanticsDir);
    if (entry === FUNCTIONS_DIR && lstatSync(full).isDirectory()) {
      for (const shard of readdirSync(full)) {
        const shardPath = path.join(full, shard);
        assertInside(realRoot, shardPath, semanticsDir);
        files.set(`${FUNCTIONS_DIR}/${shard}`, readFileSync(shardPath, "utf-8"));
      }
      continue;
    }
    files.set(entry, readFileSync(full, "utf-8"));
  }
  return files;
}

/** Sibling directories used by the swap in `writeStore`; fixed names so a crashed swap can be found. */
function swapDirs(semanticsDir: string): { staging: string; old: string } {
  const parent = path.dirname(semanticsDir);
  const base = path.basename(semanticsDir);
  return { staging: path.join(parent, `.${base}-staging`), old: path.join(parent, `.${base}-old`) };
}

function isSymlink(file: string): boolean {
  try {
    return lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Completes a swap that was interrupted: if only the moved-aside old store remains it is put back,
 * and if the new store was already swapped in the old one is discarded.
 */
function recoverInterruptedSwap(semanticsDir: string): void {
  const { old } = swapDirs(semanticsDir);
  if (!existsSync(old) && !isSymlink(old)) return;
  // writeStore only ever moves a real directory aside; anything else was planted.
  if (!lstatSync(old).isDirectory()) throw new Error(`${old} is a symlink or file, not a moved-aside store`);
  if (existsSync(semanticsDir)) rmSync(old, { recursive: true, force: true });
  else renameSync(old, semanticsDir);
}

/** Reads and validates the store on disk, first recovering any interrupted `writeStore` swap. */
export function readStoreFromDisk(semanticsDir: string): StoreContents {
  recoverInterruptedSwap(semanticsDir);
  return parseStore(readRawFromDisk(semanticsDir));
}

function sameFiles(a: Map<string, string>, b: Map<string, string>): boolean {
  return a.size === b.size && [...a].every(([rel, text]) => b.get(rel) === text);
}

/**
 * Replaces the store with `store`. Nothing is written when the rendered files equal what is on
 * disk. Otherwise the new store is built in a sibling staging directory and swapped in by two
 * renames (old store aside, new store in). A failed swap puts the old store back; a crash between
 * the renames is completed by the next read or write, so the store is always the old or the new
 * one, never a mix. Assumes a single writer.
 */
export function writeStore(semanticsDir: string, store: StoreContents): void {
  recoverInterruptedSwap(semanticsDir);
  const next = renderStore(store);
  if (sameFiles(next, readRawFromDisk(semanticsDir))) return;

  const { staging, old } = swapDirs(semanticsDir);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(path.join(staging, FUNCTIONS_DIR), { recursive: true });
  try {
    for (const [rel, text] of next) writeFileSync(path.join(staging, rel), text);
    const hadStore = existsSync(semanticsDir);
    if (hadStore) renameSync(semanticsDir, old);
    try {
      renameSync(staging, semanticsDir);
    } catch (error) {
      if (hadStore) renameSync(old, semanticsDir);
      throw error;
    }
    if (hadStore) rmSync(old, { recursive: true, force: true });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const GIT_MAX_BUFFER = 256 * 1024 * 1024;

function git(root: string, args: string[]): Buffer {
  const result = spawnSync("git", args, { cwd: root, maxBuffer: GIT_MAX_BUFFER });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.toString("utf-8").trim()}`);
  return result.stdout;
}

/** Reads and validates the store as committed at `sha`. Only regular-file blobs are accepted. */
export function readStoreFromGit(root: string, sha: string): StoreContents {
  if (!SHA.test(sha)) throw new Error(`expected a full commit sha, got ${JSON.stringify(sha)}`);
  const listing = git(root, ["ls-tree", "-r", "-z", "--full-tree", sha, "--", STORE_REL_DIR]).toString("utf-8");
  const files = new Map<string, string>();
  for (const record of listing.split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    const [mode, type, oid] = record.slice(0, tab).split(" ");
    const rel = path.posix.relative(STORE_REL_DIR, record.slice(tab + 1));
    if (type !== "blob" || !oid || (mode !== "100644" && mode !== "100755")) {
      throw new Error(`${rel}: unsupported entry in committed semantics store (mode ${mode})`);
    }
    files.set(rel, git(root, ["cat-file", "blob", oid]).toString("utf-8"));
  }
  return parseStore(files);
}

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  DeltaSchema,
  LayoutSchema,
  SnapshotSchema,
  formatFindings,
  validateSnapshotInvariants,
  type Delta,
  type Layout,
  type Snapshot,
  type Unit,
} from "@scv/schema";

export type { Layout };

export interface RevSummary {
  sha: string;
  kind: Snapshot["rev"]["kind"];
  pr?: number;
  message?: string;
  ts: string;
  author: string;
  author_kind: string;
  amount: number;
}

export interface UnitWithNeighbours {
  unit: Unit;
  neighbours: Unit[];
}

/**
 * Rejects any identifier that could steer a path join outside its intended directory. Route
 * params reach here already percent-decoded, so `..%2F` arrives as `../` — an allowlist is the
 * only reliable check, since a denylist has to anticipate every encoding.
 */
export function isSafePathSegment(segment: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(segment) && segment !== "." && segment !== "..";
}

/** Cap on findings printed per snapshot, so one pre-policy file cannot bury the startup log. */
const MAX_LOGGED_FINDINGS = 5;

/** Parsed contents of one snapshot file, plus the mtime it was parsed at. */
interface CacheEntry {
  files: Map<string, number>;
  snapshots: Snapshot[];
}

/** Reads and validates scv/1 snapshots from `<scvDir>/snapshots/*.json`, caching parsed results. */
export class SnapshotStore {
  private readonly snapshotsDir: string;
  private readonly deltasDir: string;
  private readonly layoutsDir: string;
  private cache: CacheEntry | undefined;

  constructor(scvDir: string) {
    this.snapshotsDir = path.join(scvDir, "snapshots");
    this.deltasDir = path.join(scvDir, "deltas");
    this.layoutsDir = path.join(scvDir, "layouts");
  }

  /**
   * Resolves `<dir>/<name>` and returns it only if it stays inside `dir`. Defence in depth
   * behind `isSafePathSegment`: the callers already reject unsafe params, and this makes a
   * future caller that forgets to fail closed rather than serving an arbitrary file.
   */
  private containedPath(dir: string, name: string): string | undefined {
    const full = path.resolve(dir, name);
    return full === dir || full.startsWith(dir + path.sep) ? full : undefined;
  }

  /**
   * Every snapshot file, parsed. Re-reads a file only when its mtime or size changed, so
   * repeated `listRevs`/`getSnapshot` calls do not re-parse the whole directory (~4.6MB and
   * linear in history) on each request. Schema validation makes that cost worth paying once.
   */
  private readAll(): Snapshot[] {
    let entries: string[];
    try {
      entries = readdirSync(this.snapshotsDir).filter((f) => f.endsWith(".json"));
    } catch {
      this.cache = undefined;
      return [];
    }

    const files = new Map<string, number>();
    for (const file of entries) {
      const full = this.containedPath(this.snapshotsDir, file);
      if (!full) continue;
      try {
        const stat = statSync(full);
        files.set(file, stat.mtimeMs + stat.size);
      } catch {
        // Removed between readdir and stat — treat as absent.
      }
    }

    const cached = this.cache;
    if (cached && cached.files.size === files.size && [...files].every(([f, v]) => cached.files.get(f) === v)) {
      return cached.snapshots;
    }

    const snapshots: Snapshot[] = [];
    for (const file of files.keys()) {
      const full = this.containedPath(this.snapshotsDir, file);
      if (!full) continue;
      const snapshot = parseOrThrow(SnapshotSchema, readFileSync(full, "utf-8"), full);
      reportInvariantFindings(snapshot, full);
      snapshots.push(snapshot);
    }

    this.cache = { files, snapshots };
    return snapshots;
  }

  listRevs(): RevSummary[] {
    const snapshots = [...this.readAll()].sort((a, b) => b.rev.ts.localeCompare(a.rev.ts));
    return snapshots.map((s, i) => {
      const previous = snapshots[i + 1];
      const delta = previous ? this.getDelta(previous.rev.sha, s.rev.sha) : undefined;
      const amount = delta && delta.unit_deltas.length > 0
        ? delta.unit_deltas.reduce((sum, d) => sum + d.amount, 0) / delta.unit_deltas.length
        : 0;
      return {
        sha: s.rev.sha,
        kind: s.rev.kind,
        ...(s.rev.pr !== undefined ? { pr: s.rev.pr } : {}),
        ...(s.rev.message !== undefined ? { message: s.rev.message } : {}),
        ts: s.rev.ts,
        author: s.rev.author,
        author_kind: s.rev.author_kind,
        amount,
      };
    });
  }

  getSnapshot(sha: string): Snapshot | undefined {
    return this.readAll().find((s) => s.rev.sha === sha);
  }

  getLatestSnapshot(): Snapshot | undefined {
    const [latest] = this.listRevs();
    return latest ? this.getSnapshot(latest.sha) : undefined;
  }

  getUnit(sha: string, unitId: string): UnitWithNeighbours | undefined {
    const snapshot = this.getSnapshot(sha);
    if (!snapshot) return undefined;
    const unit = snapshot.units.find((u) => u.id === unitId);
    if (!unit) return undefined;
    const neighbourIds = new Set(
      snapshot.edges.filter((e) => e.from === unitId || e.to === unitId).map((e) => (e.from === unitId ? e.to : e.from)),
    );
    const neighbours = snapshot.units.filter((u) => neighbourIds.has(u.id));
    return { unit, neighbours };
  }

  search(sha: string, query: string): Unit[] {
    const snapshot = this.getSnapshot(sha);
    if (!snapshot) return [];
    const needle = query.toLowerCase();
    return snapshot.units.filter((u) => u.qualname.toLowerCase().includes(needle));
  }

  getDelta(from: string, to: string): Delta | undefined {
    const file = this.containedPath(this.deltasDir, `${from}__${to}.json`);
    if (!file) return undefined;
    let raw: string;
    try {
      raw = readFileSync(file, "utf-8");
    } catch {
      return undefined;
    }
    return parseOrThrow(DeltaSchema, raw, file);
  }

  /** Seeded positions for replay stability (docs/serve.md#3 — "hard requirement, not polish"). */
  getLayout(sha: string, skin: string): Layout | undefined {
    const file = this.containedPath(this.layoutsDir, `${sha}.${skin}.json`);
    if (!file) return undefined;
    let raw: string;
    try {
      raw = readFileSync(file, "utf-8");
    } catch {
      return undefined;
    }
    return parseOrThrow(LayoutSchema, raw, file);
  }

  saveLayout(sha: string, skin: string, layout: Layout): void {
    const file = this.containedPath(this.layoutsDir, `${sha}.${skin}.json`);
    if (!file) throw new Error(`refusing to write layout outside ${this.layoutsDir}`);
    if (!existsSync(this.layoutsDir)) mkdirSync(this.layoutsDir, { recursive: true });
    writeFileSync(file, JSON.stringify(LayoutSchema.parse(layout)));
  }
}

/**
 * Logs referential-integrity findings without refusing the snapshot.
 *
 * The schema is the trust boundary — a file that does not parse is rejected. Hierarchy invariants
 * are different: every snapshot written before the root policy landed has orphan modules, and some
 * have no system unit at all. Refusing those would leave the server unable to serve any history
 * the repo already has, for defects the user cannot fix except by re-analyzing. So a defective
 * hierarchy is fatal where it is a bug — at analyze time, in `finalizeSnapshot` — and a logged
 * observation here, where it is a fact about a file on disk.
 */
function reportInvariantFindings(snapshot: Snapshot, file: string): void {
  const { findings } = validateSnapshotInvariants(snapshot);
  if (findings.length === 0) return;
  // A pre-policy snapshot can carry hundreds of findings; the first few name the shape of the
  // problem, and the count says how widespread it is. Dumping all of them buries the startup log.
  const shown = findings.slice(0, MAX_LOGGED_FINDINGS);
  const more = findings.length - shown.length;
  console.warn(
    `[WARN] ${file}: snapshot has ${findings.length} invariant finding(s)\n${formatFindings(shown)}` +
      (more > 0 ? `\n… and ${more} more` : ""),
  );
}

/**
 * Parses `raw` against `schema`, naming the offending file and the Zod issue path on failure.
 * Reading is the trust boundary: a truncated or hand-edited artifact should fail here, not
 * several layers deeper in the UI where the message no longer points at the cause.
 */
function parseOrThrow<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, raw: string, file: string): T {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`${file}: not valid JSON`, { cause });
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    const [issue] = result.error.issues;
    const at = issue && issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
    throw new Error(`${file}: does not match its schema${at}${issue ? `: ${issue.message}` : ""}`);
  }
  return result.data;
}

import Database from "better-sqlite3";
import { UnitSchema } from "@semviz/schema";
import type { Unit } from "@semviz/schema";
import { stripCodeFence } from "./json-response.js";
import type { ProviderResult } from "./provider.js";

/** JSON.parse that reports failure as `undefined` rather than throwing, so a corrupt row is a
 *  value to discard rather than an exception that aborts a whole lookup. */
function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export interface CacheKey {
  inputHash: string;
  promptRev: string;
  provider: string;
  model: string;
}

/** Identifies one Pass A run's per-unit results: same repo sha, prompt, provider and model. */
export interface PassAUnitsKey {
  sha: string;
  promptRev: string;
  provider: string;
  model: string;
}

/** One unit's Pass A outcome. `failed` carries the untouched structural unit and exists so a
 *  failure is retried on the next run rather than silently frozen in as "already analyzed". */
export interface PassAUnitRecord {
  unit: Unit;
  status: "ok" | "failed";
}

export interface SetPassAUnitInput extends PassAUnitRecord {
  unitId: string;
  structHash: string;
}

/** SQLite's default parameter limit is 999; each `(unit_id, struct_hash)` pair binds two. */
const SQL_PAIR_CHUNK = 400;

/** Bumped when a new one-shot cache repair ships. Stored in `meta` so the sweep it guards runs
 *  exactly once per cache file rather than on every `scv` invocation. */
const CLEANUP_REV = "1";

export interface LlmCallRecord {
  pass: "A" | "B" | "C" | "D" | "Docs";
  unitId?: string;
  qualname?: string;
  file?: string;
  inTokens: number;
  outTokens: number;
  cacheHit: boolean;
  durationMs: number;
}

export interface LoggedLlmCall extends LlmCallRecord {
  ts: string;
}

/** Content-addressed cache for Interpreter calls, keyed by input_hash + prompt_rev + provider + model (analyze.md#2, implement-analyze.md#llm-provider). */
export class ContentCache {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        input_hash TEXT NOT NULL,
        prompt_rev TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        text TEXT NOT NULL,
        tokens INTEGER NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        PRIMARY KEY (input_hash, prompt_rev, provider, model)
      )
    `);
    const columns = this.db.prepare("PRAGMA table_info(cache)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "input_tokens")) {
      this.db.exec("ALTER TABLE cache ADD COLUMN input_tokens INTEGER");
    }
    if (!columns.some((column) => column.name === "output_tokens")) {
      this.db.exec("ALTER TABLE cache ADD COLUMN output_tokens INTEGER");
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS llm_calls (
        pass TEXT NOT NULL,
        unit_id TEXT,
        qualname TEXT,
        file TEXT,
        in_tokens INTEGER NOT NULL,
        out_tokens INTEGER NOT NULL,
        cache_hit INTEGER NOT NULL,
        ts TEXT NOT NULL
      )
    `);
    const callColumns = this.db.prepare("PRAGMA table_info(llm_calls)").all() as { name: string }[];
    if (!callColumns.some((column) => column.name === "duration_ms")) {
      this.db.exec("ALTER TABLE llm_calls ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0");
    }

    // Per-unit Pass A results, so an interrupted run's completed units survive into the next one.
    // `struct_hash` is in the key: an edited unit's stored result is invalidated by its own source
    // changing, independently of the response cache above.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pass_a_units (
        sha         TEXT NOT NULL,
        unit_id     TEXT NOT NULL,
        struct_hash TEXT NOT NULL,
        prompt_rev  TEXT NOT NULL,
        provider    TEXT NOT NULL,
        model       TEXT NOT NULL,
        result_json TEXT NOT NULL,
        status      TEXT NOT NULL,
        ts          TEXT NOT NULL,
        PRIMARY KEY (sha, unit_id, struct_hash, prompt_rev, provider, model)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    this.runOneShotCleanup();
  }

  /**
   * Deletes response rows that are not parseable JSON — damage left by the earlier behaviour of
   * caching a response before validating it. Guarded by a durable marker so it runs once per cache
   * file: unguarded, it would `JSON.parse` every row of a growing cache on every `scv` invocation.
   *
   * Only catches malformed JSON. A row that parses but fails its pass's schema is unidentifiable
   * here (this layer does not know which schema a row belongs to) and is instead recovered by
   * `CachedProvider`'s read-side validation the next time that entry is looked up.
   */
  private runOneShotCleanup(): void {
    const sweep = this.db.transaction(() => {
      const marker = this.db.prepare("SELECT value FROM meta WHERE key = 'cleanup_rev'").get() as
        | { value: string }
        | undefined;
      if (marker?.value === CLEANUP_REV) return;

      const rows = this.db.prepare("SELECT input_hash, prompt_rev, provider, model, text FROM cache").all() as {
        input_hash: string;
        prompt_rev: string;
        provider: string;
        model: string;
        text: string;
      }[];
      const remove = this.db.prepare(
        "DELETE FROM cache WHERE input_hash = ? AND prompt_rev = ? AND provider = ? AND model = ?",
      );
      for (const row of rows) {
        try {
          JSON.parse(stripCodeFence(row.text));
        } catch {
          remove.run(row.input_hash, row.prompt_rev, row.provider, row.model);
        }
      }

      this.db
        .prepare("INSERT INTO meta (key, value) VALUES ('cleanup_rev', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
        .run(CLEANUP_REV);
    });
    sweep();
  }

  /**
   * Pass A results for `key`, restricted to units whose *current* `struct_hash` matches the stored
   * row. Matching on `(unit_id, struct_hash)` together is required, not an optimization: a unit
   * edited across runs accumulates one row per version, so selecting on the key alone could return
   * several rows for one unit and silently resurrect semantics for code that has since changed.
   *
   * `result_json` is text on disk — a truncated write or manual tampering can leave a row that is
   * not a valid `Unit`. Such a row is deleted and omitted, which makes the unit look unanalyzed and
   * therefore retryable on this same run.
   */
  getPassAUnits(key: PassAUnitsKey, structHashByUnitId: Map<string, string>): Map<string, PassAUnitRecord> {
    const results = new Map<string, PassAUnitRecord>();
    const pairs = [...structHashByUnitId];
    const corrupt: { unitId: string; structHash: string }[] = [];

    for (let i = 0; i < pairs.length; i += SQL_PAIR_CHUNK) {
      const chunk = pairs.slice(i, i + SQL_PAIR_CHUNK);
      const placeholders = chunk.map(() => "(?, ?)").join(", ");
      const rows = this.db
        .prepare(
          `SELECT unit_id, struct_hash, result_json, status FROM pass_a_units
           WHERE sha = ? AND prompt_rev = ? AND provider = ? AND model = ?
             AND (unit_id, struct_hash) IN (${placeholders})`,
        )
        .all(key.sha, key.promptRev, key.provider, key.model, ...chunk.flat()) as {
        unit_id: string;
        struct_hash: string;
        result_json: string;
        status: string;
      }[];

      for (const row of rows) {
        const parsed = UnitSchema.safeParse(safeJsonParse(row.result_json));
        if (!parsed.success || (row.status !== "ok" && row.status !== "failed")) {
          corrupt.push({ unitId: row.unit_id, structHash: row.struct_hash });
          continue;
        }
        results.set(row.unit_id, { unit: parsed.data, status: row.status });
      }
    }

    if (corrupt.length > 0) {
      const remove = this.db.prepare(
        `DELETE FROM pass_a_units
         WHERE sha = ? AND prompt_rev = ? AND provider = ? AND model = ? AND unit_id = ? AND struct_hash = ?`,
      );
      const removeAll = this.db.transaction(() => {
        for (const row of corrupt) remove.run(key.sha, key.promptRev, key.provider, key.model, row.unitId, row.structHash);
      });
      removeAll();
    }

    return results;
  }

  /** Records one unit's Pass A outcome, durably, as soon as it completes. */
  setPassAUnit(key: PassAUnitsKey, record: SetPassAUnitInput): void {
    this.db
      .prepare(
        `INSERT INTO pass_a_units (sha, unit_id, struct_hash, prompt_rev, provider, model, result_json, status, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (sha, unit_id, struct_hash, prompt_rev, provider, model)
         DO UPDATE SET result_json = excluded.result_json, status = excluded.status, ts = excluded.ts`,
      )
      .run(
        key.sha,
        record.unitId,
        record.structHash,
        key.promptRev,
        key.provider,
        key.model,
        JSON.stringify(record.unit),
        record.status,
        new Date().toISOString(),
      );
  }

  /** Records one LLM call (or cache hit) for cost/duplication analysis. See docs/llm-call-observability.md. */
  logCall(record: LlmCallRecord): void {
    this.db
      .prepare(
        `INSERT INTO llm_calls (pass, unit_id, qualname, file, in_tokens, out_tokens, cache_hit, duration_ms, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.pass,
        record.unitId ?? null,
        record.qualname ?? null,
        record.file ?? null,
        record.inTokens,
        record.outTokens,
        record.cacheHit ? 1 : 0,
        record.durationMs,
        new Date().toISOString(),
      );
  }

  listCalls(): LoggedLlmCall[] {
    const rows = this.db
      .prepare("SELECT pass, unit_id, qualname, file, in_tokens, out_tokens, cache_hit, duration_ms, ts FROM llm_calls ORDER BY ts")
      .all() as {
      pass: LlmCallRecord["pass"];
      unit_id: string | null;
      qualname: string | null;
      file: string | null;
      in_tokens: number;
      out_tokens: number;
      cache_hit: number;
      duration_ms: number;
      ts: string;
    }[];
    return rows.map((row) => ({
      pass: row.pass,
      ...(row.unit_id === null ? {} : { unitId: row.unit_id }),
      ...(row.qualname === null ? {} : { qualname: row.qualname }),
      ...(row.file === null ? {} : { file: row.file }),
      inTokens: row.in_tokens,
      outTokens: row.out_tokens,
      cacheHit: row.cache_hit === 1,
      durationMs: row.duration_ms,
      ts: row.ts,
    }));
  }

  get(key: CacheKey): ProviderResult | undefined {
    const row = this.db
      .prepare(
        "SELECT text, tokens, input_tokens, output_tokens FROM cache WHERE input_hash = ? AND prompt_rev = ? AND provider = ? AND model = ?",
      )
      .get(key.inputHash, key.promptRev, key.provider, key.model) as
      | { text: string; tokens: number; input_tokens: number | null; output_tokens: number | null }
      | undefined;
    if (!row) return undefined;
    return {
      text: row.text,
      tokens: row.tokens,
      ...(row.input_tokens === null ? {} : { inputTokens: row.input_tokens }),
      ...(row.output_tokens === null ? {} : { outputTokens: row.output_tokens }),
    };
  }

  set(key: CacheKey, result: ProviderResult): void {
    this.db
      .prepare(
        `INSERT INTO cache (input_hash, prompt_rev, provider, model, text, tokens, input_tokens, output_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (input_hash, prompt_rev, provider, model)
         DO UPDATE SET text = excluded.text, tokens = excluded.tokens,
           input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens`,
      )
      .run(
        key.inputHash,
        key.promptRev,
        key.provider,
        key.model,
        result.text,
        result.tokens,
        result.inputTokens ?? null,
        result.outputTokens ?? null,
      );
  }

  /** Removes one response row. Used to evict an entry whose stored text fails validation, so a
   *  poisoned row cannot be served forever and a retry can actually reach the provider. */
  delete(key: CacheKey): void {
    this.db
      .prepare("DELETE FROM cache WHERE input_hash = ? AND prompt_rev = ? AND provider = ? AND model = ?")
      .run(key.inputHash, key.promptRev, key.provider, key.model);
  }

  close(): void {
    this.db.close();
  }
}

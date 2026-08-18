import Database from "better-sqlite3";
import type { ProviderResult } from "./provider.js";

export interface CacheKey {
  inputHash: string;
  promptRev: string;
  provider: string;
  model: string;
}

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

  close(): void {
    this.db.close();
  }
}

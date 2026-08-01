import Database from "better-sqlite3";
import type { ProviderResult } from "./provider.js";

export interface CacheKey {
  inputHash: string;
  promptRev: string;
  provider: string;
  model: string;
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
        PRIMARY KEY (input_hash, prompt_rev, provider, model)
      )
    `);
  }

  get(key: CacheKey): ProviderResult | undefined {
    const row = this.db
      .prepare(
        "SELECT text, tokens FROM cache WHERE input_hash = ? AND prompt_rev = ? AND provider = ? AND model = ?",
      )
      .get(key.inputHash, key.promptRev, key.provider, key.model) as
      | { text: string; tokens: number }
      | undefined;
    return row ? { text: row.text, tokens: row.tokens } : undefined;
  }

  set(key: CacheKey, result: ProviderResult): void {
    this.db
      .prepare(
        `INSERT INTO cache (input_hash, prompt_rev, provider, model, text, tokens)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (input_hash, prompt_rev, provider, model)
         DO UPDATE SET text = excluded.text, tokens = excluded.tokens`,
      )
      .run(key.inputHash, key.promptRev, key.provider, key.model, result.text, result.tokens);
  }

  close(): void {
    this.db.close();
  }
}

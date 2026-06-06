// Local run history — a single SQLite file, created on first use.
//
// This is a trusted local app: the DB lives at data/council.db next to the
// project (override with COUNCIL_DB_PATH). Saving is fail-soft — a broken DB
// must never kill a live council stream.

import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

export interface HistoryRun {
  id: number;
  createdAt: string;
  cardId: string;
  cardName: string;
  outcomeName: string | null;
  eventName: string | null;
  probability: number | null;
  call: string | null;
  verdict: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

export type NewHistoryRun = Omit<HistoryRun, "id" | "createdAt"> & { cardJson?: string };

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  const file = process.env.COUNCIL_DB_PATH ?? path.join(process.cwd(), "data", "council.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      card_id TEXT NOT NULL,
      card_name TEXT NOT NULL,
      outcome_name TEXT,
      event_name TEXT,
      probability INTEGER,
      call TEXT,
      verdict TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      card_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_runs_card ON runs(card_id);
    CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at);
  `);
  return db;
}

/** Persist one finished council run. Fail-soft: logs and returns on any DB error. */
export function saveRun(run: NewHistoryRun): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO runs
           (card_id, card_name, outcome_name, event_name, probability, call, verdict,
            input_tokens, output_tokens, cache_read_tokens, cost_usd, card_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.cardId,
        run.cardName,
        run.outcomeName,
        run.eventName,
        run.probability,
        run.call,
        run.verdict,
        run.inputTokens,
        run.outputTokens,
        run.cacheReadTokens,
        run.costUsd,
        run.cardJson ?? null
      );
  } catch (err) {
    console.error("history: failed to save run:", err);
  }
}

type RunRow = {
  id: number;
  created_at: string;
  card_id: string;
  card_name: string;
  outcome_name: string | null;
  event_name: string | null;
  probability: number | null;
  call: string | null;
  verdict: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
};

/** Most-recent-first run history, optionally filtered by a search term. */
export function listRuns(opts: { search?: string; limit?: number } = {}): HistoryRun[] {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const search = opts.search?.trim();
  const where = search
    ? `WHERE card_name LIKE @q OR event_name LIKE @q OR outcome_name LIKE @q OR card_id LIKE @q`
    : "";
  const rows = getDb()
    .prepare(
      `SELECT id, created_at, card_id, card_name, outcome_name, event_name, probability, call,
              verdict, input_tokens, output_tokens, cache_read_tokens, cost_usd
       FROM runs ${where} ORDER BY id DESC LIMIT @limit`
    )
    .all({ limit, ...(search ? { q: `%${search}%` } : {}) }) as RunRow[];
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    cardId: r.card_id,
    cardName: r.card_name,
    outcomeName: r.outcome_name,
    eventName: r.event_name,
    probability: r.probability,
    call: r.call,
    verdict: r.verdict,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens,
    costUsd: r.cost_usd,
  }));
}

/** Delete one run by id. */
export function deleteRun(id: number): void {
  getDb().prepare(`DELETE FROM runs WHERE id = ?`).run(id);
}

/** Wipe the whole history. */
export function clearRuns(): void {
  getDb().exec(`DELETE FROM runs`);
}

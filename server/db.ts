import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = process.env.CACHE_DB_PATH ?? path.join(process.cwd(), 'data', 'cache.db');

// Ensure parent directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Create all required tables if they do not already exist.
 * Migration-safe: uses IF NOT EXISTS everywhere.
 */
export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS collection (
      id          TEXT PRIMARY KEY,
      artist      TEXT NOT NULL,
      title       TEXT NOT NULL,
      year        TEXT,
      release_date TEXT,
      genre       TEXT,
      format      TEXT,
      country     TEXT,
      release_status TEXT,
      edition     TEXT,
      musicbrainz_id TEXT,
      release_group_id TEXT,
      release_group_title TEXT,
      release_group_url TEXT,
      release_url TEXT,
      discogs_url TEXT,
      thumbnail_url TEXT,
      cover_url   TEXT,
      date_added  INTEGER NOT NULL,
      notes       TEXT
    );

    CREATE TABLE IF NOT EXISTS cover_cache (
      cache_key   TEXT PRIMARY KEY,
      cover_url   TEXT NOT NULL,
      fetched_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_vision_call_tracker (
      date        TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      call_count  INTEGER NOT NULL,
      PRIMARY KEY (date, user_id)
    );

    CREATE TABLE IF NOT EXISTS scan_history (
      id                  TEXT PRIMARY KEY,
      created_at          INTEGER NOT NULL,
      image_url           TEXT,
      vision_guesses      TEXT,
      suggested_query     TEXT,
      initial_suggestions TEXT,
      searches            TEXT NOT NULL DEFAULT '[]'
    );
  `);

  // Incremental migration: add phash column if it doesn't exist yet
  const cols = db.pragma('table_info(collection)') as Array<{ name: string }>;
  const addColumnIfMissing = (columnName: string, columnType: string) => {
    if (!cols.some((c) => c.name === columnName)) {
      db.exec(`ALTER TABLE collection ADD COLUMN ${columnName} ${columnType}`);
      console.log(`[db] Added ${columnName} column to collection`);
    }
  };

  addColumnIfMissing('phash', 'TEXT');
  addColumnIfMissing('user_id', 'TEXT');

  const scanHistoryCols = db.pragma('table_info(scan_history)') as Array<{ name: string }>;
  if (!scanHistoryCols.some((c) => c.name === 'user_id')) {
    db.exec('ALTER TABLE scan_history ADD COLUMN user_id TEXT');
    console.log('[db] Added user_id column to scan_history');
  }
  addColumnIfMissing('release_date', 'TEXT');
  addColumnIfMissing('format', 'TEXT');
  addColumnIfMissing('country', 'TEXT');
  addColumnIfMissing('release_status', 'TEXT');
  addColumnIfMissing('edition', 'TEXT');
  addColumnIfMissing('musicbrainz_id', 'TEXT');
  addColumnIfMissing('release_group_id', 'TEXT');
  addColumnIfMissing('release_group_title', 'TEXT');
  addColumnIfMissing('release_group_url', 'TEXT');
  addColumnIfMissing('release_url', 'TEXT');
  addColumnIfMissing('discogs_url', 'TEXT');
  addColumnIfMissing('thumbnail_url', 'TEXT');

  console.log('[db] Database initialised at', DB_PATH);
}

/**
 * Atomically increments and returns a user's vision-call counter for `date`
 * (YYYY-MM-DD). Used to enforce each user's daily cap on AI vision calls.
 *
 * Synchronous and called before any `await` in the caller, so there's no
 * race window across concurrent requests: better-sqlite3 is synchronous and
 * Node is single-threaded, so this statement always completes atomically
 * before another request's handler can run.
 */
export function incrementUserVisionCallCount(date: string, userId: string): number {
  const row = db
    .prepare(
      `INSERT INTO user_vision_call_tracker (date, user_id, call_count) VALUES (?, ?, 1)
       ON CONFLICT(date, user_id) DO UPDATE SET call_count = call_count + 1
       RETURNING call_count`,
    )
    .get(date, userId) as { call_count: number };
  return row.call_count;
}

/**
 * Reads a user's vision-call counter for `date` (YYYY-MM-DD) without
 * incrementing it — used to show the user their remaining daily scan
 * allowance. Returns 0 for a user/date with no recorded calls.
 */
export function getUserVisionCallCount(date: string, userId: string): number {
  const row = db
    .prepare('SELECT call_count FROM user_vision_call_tracker WHERE date = ? AND user_id = ?')
    .get(date, userId) as { call_count: number } | undefined;
  return row?.call_count ?? 0;
}

/**
 * Deletes a user's `scan_history` rows except their `keep` most recent,
 * returning the `id` of each pruned row so the caller can also remove its
 * stored blob (blob storage keys are derived from the id, not stored
 * separately). Per-user, so one user's scanning never evicts another's
 * history. Keeps scan history's DB + storage footprint bounded without any
 * separate maintenance job.
 */
export function pruneScanHistory(keep: number, userId: string): string[] {
  const rows = db
    .prepare(
      `DELETE FROM scan_history
       WHERE user_id = ?
         AND id NOT IN (
           SELECT id FROM scan_history WHERE user_id = ?
           ORDER BY created_at DESC, rowid DESC LIMIT ?
         )
       RETURNING id`,
    )
    .all(userId, userId, keep) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

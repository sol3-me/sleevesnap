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

    CREATE TABLE IF NOT EXISTS vision_call_tracker (
      date        TEXT PRIMARY KEY,
      call_count  INTEGER NOT NULL
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
 * Atomically increments and returns today's vision-call counter for `date`
 * (YYYY-MM-DD). Used to enforce the global daily cap on AI vision calls.
 *
 * Synchronous and called before any `await` in the caller, so there's no
 * race window across concurrent requests: better-sqlite3 is synchronous and
 * Node is single-threaded, so this statement always completes atomically
 * before another request's handler can run.
 */
export function incrementVisionCallCount(date: string): number {
  const row = db
    .prepare(
      `INSERT INTO vision_call_tracker (date, call_count) VALUES (?, 1)
       ON CONFLICT(date) DO UPDATE SET call_count = call_count + 1
       RETURNING call_count`,
    )
    .get(date) as { call_count: number };
  return row.call_count;
}

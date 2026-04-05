import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

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
      genre       TEXT,
      cover_url   TEXT,
      date_added  INTEGER NOT NULL,
      notes       TEXT
    );

    CREATE TABLE IF NOT EXISTS cover_cache (
      cache_key   TEXT PRIMARY KEY,
      cover_url   TEXT NOT NULL,
      fetched_at  INTEGER NOT NULL
    );
  `);

  // Incremental migration: add phash column if it doesn't exist yet
  const cols = db.pragma('table_info(collection)') as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'phash')) {
    db.exec('ALTER TABLE collection ADD COLUMN phash TEXT');
    console.log('[db] Added phash column to collection');
  }

  console.log('[db] Database initialised at', DB_PATH);
}

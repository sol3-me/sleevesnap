import { Router } from 'express';
import { db } from '../db.js';

export const collectionRouter = Router();

interface CollectionRow {
  id: string;
  artist: string;
  title: string;
  year: string | null;
  genre: string | null;
  cover_url: string | null;
  date_added: number;
  notes: string | null;
  phash: string | null;
}

function rowToRecord(row: CollectionRow) {
  return {
    id: row.id,
    artist: row.artist,
    title: row.title,
    year: row.year ?? undefined,
    genre: row.genre ?? undefined,
    coverUrl: row.cover_url ?? undefined,
    dateAdded: row.date_added,
    notes: row.notes ?? undefined,
  };
}

// GET /api/collection
collectionRouter.get('/', (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM collection ORDER BY date_added DESC')
    .all() as CollectionRow[];
  res.json(rows.map(rowToRecord));
});

// POST /api/collection  – add a record (deduplicates by artist + title)
collectionRouter.post('/', (req, res) => {
  const { id, artist, title, year, genre, coverUrl, dateAdded, notes } = req.body;

  if (!id || !artist || !title) {
    res.status(400).json({ error: 'id, artist, and title are required' });
    return;
  }

  const existing = db
    .prepare(
      'SELECT id FROM collection WHERE lower(artist) = lower(?) AND lower(title) = lower(?)',
    )
    .get(artist, title);

  if (existing) {
    res.status(409).json({ error: 'Record already in collection' });
    return;
  }

  db.prepare(
    `INSERT INTO collection (id, artist, title, year, genre, cover_url, date_added, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, artist, title, year ?? null, genre ?? null, coverUrl ?? null, dateAdded ?? Date.now(), notes ?? null);

  // Fire-and-forget: compute and store a pHash for this cover so it can be
  // matched by future scans.  We do this after responding so it never blocks.
  if (coverUrl && typeof coverUrl === 'string') {
    void computeAndStorePHash(id, coverUrl);
  }

  res.status(201).json({ success: true });
});

// DELETE /api/collection/:id
collectionRouter.delete('/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM collection WHERE id = ?').run(id);
  res.json({ success: true });
});

/**
 * Fetches the cover image at `coverUrl`, computes a dHash, and persists it.
 * Errors are swallowed so this never crashes the server.
 */
async function computeAndStorePHash(id: string, coverUrl: string): Promise<void> {
  try {
    const res = await fetch(coverUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return;
    const buf = Buffer.from(await res.arrayBuffer());
    const { computeHash } = await import('../imageHash.js');
    const hash = await computeHash(buf);
    db.prepare('UPDATE collection SET phash = ? WHERE id = ?').run(hash, id);
  } catch (err) {
    console.warn(`[collection] Could not compute pHash for record ${id}:`, err);
  }
}

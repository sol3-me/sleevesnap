import { Router } from 'express';
import { db } from '../db.js';
import { isSafeExternalUrl } from '../urlUtils.js';

export const collectionRouter = Router();

interface CollectionRow {
  id: string;
  artist: string;
  title: string;
  year: string | null;
  release_date: string | null;
  genre: string | null;
  format: string | null;
  country: string | null;
  release_status: string | null;
  edition: string | null;
  musicbrainz_id: string | null;
  release_group_id: string | null;
  release_group_title: string | null;
  release_group_url: string | null;
  release_url: string | null;
  discogs_url: string | null;
  thumbnail_url: string | null;
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
    releaseDate: row.release_date ?? undefined,
    genre: row.genre ?? undefined,
    format: row.format ?? undefined,
    country: row.country ?? undefined,
    releaseStatus: row.release_status ?? undefined,
    edition: row.edition ?? undefined,
    musicBrainzId: row.musicbrainz_id ?? undefined,
    releaseGroupId: row.release_group_id ?? undefined,
    releaseGroupTitle: row.release_group_title ?? undefined,
    releaseGroupUrl: row.release_group_url ?? undefined,
    releaseUrl: row.release_url ?? undefined,
    discogsUrl: row.discogs_url ?? undefined,
    thumbnailUrl: row.thumbnail_url ?? undefined,
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
  const {
    id,
    artist,
    title,
    year,
    releaseDate,
    genre,
    format,
    country,
    releaseStatus,
    edition,
    musicBrainzId,
    releaseGroupId,
    releaseGroupTitle,
    releaseGroupUrl,
    releaseUrl,
    discogsUrl,
    thumbnailUrl,
    coverUrl,
    dateAdded,
    notes,
  } = req.body;

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
    `INSERT INTO collection (
      id,
      artist,
      title,
      year,
      release_date,
      genre,
      format,
      country,
      release_status,
      edition,
      musicbrainz_id,
      release_group_id,
      release_group_title,
      release_group_url,
      release_url,
      discogs_url,
      thumbnail_url,
      cover_url,
      date_added,
      notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    artist,
    title,
    year ?? null,
    releaseDate ?? null,
    genre ?? null,
    format ?? null,
    country ?? null,
    releaseStatus ?? null,
    edition ?? null,
    musicBrainzId ?? null,
    releaseGroupId ?? null,
    releaseGroupTitle ?? null,
    releaseGroupUrl ?? null,
    releaseUrl ?? null,
    discogsUrl ?? null,
    thumbnailUrl ?? null,
    coverUrl ?? null,
    dateAdded ?? Date.now(),
    notes ?? null,
  );

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
  if (!isSafeExternalUrl(coverUrl)) {
    console.warn('[collection] Skipping pHash: unsafe URL rejected');
    return;
  }
  try {
    const res = await fetch(coverUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return;
    const buf = Buffer.from(await res.arrayBuffer());
    const { computeHash } = await import('../imageHash.js');
    const hash = await computeHash(buf);
    db.prepare('UPDATE collection SET phash = ? WHERE id = ?').run(hash, id);
  } catch (err) {
    console.warn('[collection] Could not compute pHash:', err);
  }
}

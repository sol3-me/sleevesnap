import { Router, type Request, type Response } from 'express';
import { db } from '../db.js';
import { computeHash } from '../imageHash.js';
import { createThumbnail } from '../services/thumbnail.js';
import { createStorageProvider } from '../storage/index.js';
import { isSafeExternalUrl } from '../urlUtils.js';

const storage = createStorageProvider();

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
  cover_source: string | null;
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
    coverSource: row.cover_source ?? 'musicbrainz',
    dateAdded: row.date_added,
    notes: row.notes ?? undefined,
  };
}

// Routes below assume the auth middleware ran; a missing user is a server
// wiring mistake, not a client error, but answering 401 keeps data safe.
function requireUid(req: Request, res: Response): string | undefined {
  const uid = req.user?.uid;
  if (!uid) {
    res.status(401).json({ error: 'Authentication required' });
  }
  return uid;
}

// GET /api/collection
collectionRouter.get('/', (req, res) => {
  const uid = requireUid(req, res);
  if (!uid) return;
  const rows = db
    .prepare('SELECT * FROM collection WHERE user_id = ? ORDER BY date_added DESC')
    .all(uid) as CollectionRow[];
  res.json(rows.map(rowToRecord));
});

// PATCH /api/collection/:id/cover – set a custom cover photo, or revert to
// the MusicBrainz-sourced one. Reverting only flips cover_source back; the
// previously uploaded photo is left in storage untouched, so the user can
// toggle between the two without re-uploading each time.
collectionRouter.patch('/:id/cover', async (req, res) => {
  const uid = requireUid(req, res);
  if (!uid) return;

  const { id } = req.params;
  const existing = db.prepare('SELECT id FROM collection WHERE id = ? AND user_id = ?').get(id, uid);
  if (!existing) {
    res.status(404).json({ error: 'Record not found' });
    return;
  }

  const { photo, source } = req.body as { photo?: string; source?: string };

  if (source === 'musicbrainz') {
    db.prepare('UPDATE collection SET cover_source = ? WHERE id = ? AND user_id = ?').run(
      'musicbrainz',
      id,
      uid,
    );
  } else if (typeof photo === 'string' && photo.length > 0) {
    let buffer: Buffer;
    let thumbBuffer: Buffer;
    try {
      buffer = Buffer.from(photo, 'base64');
      thumbBuffer = await createThumbnail(buffer);
    } catch {
      res.status(400).json({ error: 'Could not decode image' });
      return;
    }

    const stamp = Date.now();
    const coverUrl = await storage.put(`collection-covers/${id}-${stamp}.jpg`, buffer, 'image/jpeg');
    const thumbnailUrl = await storage.put(
      `collection-covers/${id}-${stamp}-thumb.jpg`,
      thumbBuffer,
      'image/jpeg',
    );

    let phash: string | null = null;
    try {
      phash = await computeHash(buffer);
    } catch (err) {
      console.warn('[collection] Could not compute pHash for uploaded cover:', err);
    }

    db.prepare(
      'UPDATE collection SET cover_url = ?, thumbnail_url = ?, cover_source = ?, phash = ? WHERE id = ? AND user_id = ?',
    ).run(coverUrl, thumbnailUrl, 'user', phash, id, uid);
  } else {
    res.status(400).json({ error: 'photo or source is required' });
    return;
  }

  const saved = db.prepare('SELECT * FROM collection WHERE id = ?').get(id) as CollectionRow;
  res.json({ success: true, record: rowToRecord(saved) });
});

// POST /api/collection  – add a record. Deduplicates by musicBrainzId when
// present (a specific pressing/edition), so a collector can own both an
// original pressing and a later reissue of the same album — falls back to
// artist+title only when neither record has a musicBrainzId to compare.
collectionRouter.post('/', (req, res) => {
  const uid = requireUid(req, res);
  if (!uid) return;
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

  const existing = musicBrainzId
    ? db
        .prepare('SELECT id FROM collection WHERE user_id = ? AND musicbrainz_id = ?')
        .get(uid, musicBrainzId)
    : db
        .prepare(
          'SELECT id FROM collection WHERE user_id = ? AND lower(artist) = lower(?) AND lower(title) = lower(?) AND musicbrainz_id IS NULL',
        )
        .get(uid, artist, title);

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
      cover_source,
      date_added,
      notes,
      user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    'musicbrainz',
    dateAdded ?? Date.now(),
    notes ?? null,
    uid,
  );

  // Fire-and-forget: compute and store a pHash for this cover so it can be
  // matched by future scans.  We do this after responding so it never blocks.
  if (coverUrl && typeof coverUrl === 'string') {
    void computeAndStorePHash(id, coverUrl);
  }

  res.status(201).json({ success: true });
});

// POST /api/collection/import – bulk-insert an exported collection in one
// request. Client-side looping N individual POSTs would blow through
// apiLimiter's 100 req/min cap for any real collector's backup, so this
// applies the same dedup rule as the single-record POST above but in a
// single transaction. pHash computation is intentionally skipped here (see
// computeAndStorePHash) — firing a cover-art fetch per imported record would
// turn a large import into its own request storm.
collectionRouter.post('/import', (req, res) => {
  const uid = requireUid(req, res);
  if (!uid) return;

  const { records } = req.body;
  if (!Array.isArray(records)) {
    res.status(400).json({ error: 'records must be an array' });
    return;
  }

  const findExisting = db.prepare(
    'SELECT id FROM collection WHERE user_id = ? AND musicbrainz_id = ?',
  );
  const findExistingByTitle = db.prepare(
    'SELECT id FROM collection WHERE user_id = ? AND lower(artist) = lower(?) AND lower(title) = lower(?) AND musicbrainz_id IS NULL',
  );
  const insert = db.prepare(
    `INSERT INTO collection (
      id, artist, title, year, release_date, genre, format, country,
      release_status, edition, musicbrainz_id, release_group_id,
      release_group_title, release_group_url, release_url, discogs_url,
      thumbnail_url, cover_url, cover_source, date_added, notes, user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const importAll = db.transaction((entries: typeof records) => {
    let added = 0;
    let duplicates = 0;

    for (const entry of entries) {
      const {
        id, artist, title, year, releaseDate, genre, format, country,
        releaseStatus, edition, musicBrainzId, releaseGroupId,
        releaseGroupTitle, releaseGroupUrl, releaseUrl, discogsUrl,
        thumbnailUrl, coverUrl, dateAdded, notes,
      } = entry ?? {};

      if (!id || !artist || !title) {
        continue;
      }

      const existing = musicBrainzId
        ? findExisting.get(uid, musicBrainzId)
        : findExistingByTitle.get(uid, artist, title);

      if (existing) {
        duplicates += 1;
        continue;
      }

      insert.run(
        id, artist, title, year ?? null, releaseDate ?? null, genre ?? null,
        format ?? null, country ?? null, releaseStatus ?? null, edition ?? null,
        musicBrainzId ?? null, releaseGroupId ?? null, releaseGroupTitle ?? null,
        releaseGroupUrl ?? null, releaseUrl ?? null, discogsUrl ?? null,
        thumbnailUrl ?? null, coverUrl ?? null, 'musicbrainz', dateAdded ?? Date.now(), notes ?? null,
        uid,
      );
      added += 1;
    }

    return { added, duplicates };
  });

  res.json(importAll(records));
});

// DELETE /api/collection – clear the entire collection for this user
collectionRouter.delete('/', (req, res) => {
  const uid = requireUid(req, res);
  if (!uid) return;
  db.prepare('DELETE FROM collection WHERE user_id = ?').run(uid);
  res.json({ success: true });
});

// DELETE /api/collection/:id
collectionRouter.delete('/:id', (req, res) => {
  const uid = requireUid(req, res);
  if (!uid) return;
  const { id } = req.params;
  db.prepare('DELETE FROM collection WHERE id = ? AND user_id = ?').run(id, uid);
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

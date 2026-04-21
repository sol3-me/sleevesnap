import { randomUUID } from 'crypto';
import { Router } from 'express';
import { db } from '../db.js';
import { computeHash } from '../imageHash.js';
import type { BlobStorageProvider } from '../storage/BlobStorageProvider.js';
import { isSafeExternalUrl } from '../urlUtils.js';

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

/**
 * Creates the scans upload router.
 *
 * POST /api/scans
 *
 * Saves a confirmed scan result to the collection.  The request body must
 * include album metadata and at least one of:
 *   - `capturedImage`  – base64-encoded photo of the sleeve (from the scanner)
 *   - `coverUrl`       – URL of the cover art returned by a search provider
 *
 * The endpoint:
 *  1. Stores the captured image via BlobStorageProvider (if provided)
 *  2. Computes a perceptual hash for future local matching
 *  3. Inserts (or skips duplicate) the record in the collection
 *  4. Returns the saved VinylRecord
 */
export function createScansRouter(storage: BlobStorageProvider): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const {
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
      notes,
      capturedImage, // base64 photo from scanner
      coverUrl: providedCoverUrl, // URL from search result
    } = req.body as {
      artist?: string;
      title?: string;
      year?: string;
      releaseDate?: string;
      genre?: string;
      format?: string;
      country?: string;
      releaseStatus?: string;
      edition?: string;
      musicBrainzId?: string;
      releaseGroupId?: string;
      releaseGroupTitle?: string;
      releaseGroupUrl?: string;
      releaseUrl?: string;
      discogsUrl?: string;
      thumbnailUrl?: string;
      notes?: string;
      capturedImage?: string;
      coverUrl?: string;
    };

    if (!artist || !title) {
      res.status(400).json({ error: 'artist and title are required' });
      return;
    }

    // Deduplicate by artist + title (case-insensitive)
    const existing = db
      .prepare(
        'SELECT * FROM collection WHERE lower(artist) = lower(?) AND lower(title) = lower(?)',
      )
      .get(artist, title) as CollectionRow | undefined;

    if (existing) {
      res.status(409).json({ error: 'Record already in collection', record: rowToRecord(existing) });
      return;
    }

    const id = randomUUID();
    const dateAdded = Date.now();
    // Only accept the coverUrl if it points to a safe external host
    let coverUrl: string | null =
      providedCoverUrl && isSafeExternalUrl(providedCoverUrl) ? providedCoverUrl : null;
    let phash: string | null = null;

    // If the user provided a captured photo, store it and use it as the cover
    if (capturedImage && typeof capturedImage === 'string') {
      try {
        const imageBuffer = Buffer.from(capturedImage, 'base64');

        // Compute pHash for future local matching
        try {
          phash = await computeHash(imageBuffer);
        } catch (hashErr) {
          console.warn('[scans] Could not compute pHash for captured image:', hashErr);
        }

        // Store via BlobStorageProvider (override coverUrl with the stored URL)
        const key = `scans/${id}.jpg`;
        const storedUrl = await storage.put(key, imageBuffer, 'image/jpeg');
        coverUrl = storedUrl;
      } catch (err) {
        console.warn('[scans] Could not store captured image, continuing without it:', err);
      }
    }

    // If no pHash yet but we have a coverUrl, fetch that image and hash it
    if (!phash && coverUrl) {
      void fetchAndHash(coverUrl, id).then((hash) => {
        if (hash) {
          db.prepare('UPDATE collection SET phash = ? WHERE id = ?').run(hash, id);
        }
      });
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
        notes,
        phash
      )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      coverUrl,
      dateAdded,
      notes ?? null,
      phash,
    );

    const saved = db
      .prepare('SELECT * FROM collection WHERE id = ?')
      .get(id) as CollectionRow;

    res.status(201).json({ success: true, record: rowToRecord(saved) });
  });

  return router;
}

/**
 * Fetches an image from a URL, computes its dHash, and returns it.
 * Errors are swallowed so this can be used in fire-and-forget mode.
 */
async function fetchAndHash(url: string, recordId: string): Promise<string | null> {
  if (!isSafeExternalUrl(url)) {
    console.warn('[scans] fetchAndHash skipped: unsafe URL rejected');
    return null;
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const { computeHash } = await import('../imageHash.js');
    return await computeHash(buf);
  } catch (err) {
    console.warn('[scans] fetchAndHash failed for record', recordId, err);
    return null;
  }
}

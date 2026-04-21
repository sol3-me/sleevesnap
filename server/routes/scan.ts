import { Router } from 'express';
import { db } from '../db.js';
import { computeHash, hammingDistance } from '../imageHash.js';

export const scanRouter = Router();

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
 * POST /api/scan
 *
 * Accepts a base64-encoded JPEG/PNG and attempts to identify the vinyl sleeve
 * by comparing its perceptual hash (dHash) against hashes stored for every
 * record in the user's collection.
 *
 * Response:
 *   { matched: true,  record: VinylRecord }  – collection match found
 *   { matched: false }                        – no match; caller should prompt
 *                                               the user to search manually
 */
scanRouter.post('/', async (req, res) => {
  const { base64Image } = req.body;

  if (!base64Image || typeof base64Image !== 'string') {
    res.status(400).json({ error: 'base64Image is required' });
    return;
  }

  let imageBuffer: Buffer;
  try {
    imageBuffer = Buffer.from(base64Image, 'base64');
  } catch {
    res.status(400).json({ error: 'Invalid base64 image data' });
    return;
  }

  let scanHash: string;
  try {
    scanHash = await computeHash(imageBuffer);
  } catch (err) {
    console.error('[scan] Failed to hash image:', err);
    res.status(400).json({ error: 'Could not process image' });
    return;
  }

  // Retrieve all collection items that have a stored hash
  const rows = db
    .prepare('SELECT * FROM collection WHERE phash IS NOT NULL')
    .all() as CollectionRow[];

  let bestMatch: CollectionRow | null = null;
  let bestDistance = Infinity;

  for (const row of rows) {
    if (!row.phash) continue;
    const dist = hammingDistance(scanHash, row.phash);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestMatch = row;
    }
  }

  const MATCH_THRESHOLD = 15; // bits; tuned for real-world photo variation
  if (bestMatch && bestDistance <= MATCH_THRESHOLD) {
    res.json({ matched: true, record: rowToRecord(bestMatch) });
  } else {
    res.json({ matched: false });
  }
});



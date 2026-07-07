import { Router } from 'express';
import { db, incrementVisionCallCount } from '../db.js';
import { computeHash, hammingDistance } from '../imageHash.js';
import { identifyVinyl } from '../services/visionProvider/index.js';
import { searchReleasesByText } from './search.js';

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
    return;
  }

  const suggestions = await getVisionSuggestions(imageBuffer, req.header('x-vision-admin-key'));
  if (suggestions.length > 0) {
    res.json({ matched: false, suggestions });
  } else {
    res.json({ matched: false });
  }
});

const DEFAULT_VISION_DAILY_LIMIT = 5;
const VALIDATION_SEARCH_LIMIT = 5;

/**
 * Runs the vision-assisted identification + MusicBrainz validation flow for
 * a photo that didn't match anything in the collection. Enforces a global
 * daily cap on vision-provider calls (this app has no per-user accounts, so
 * the cap is shared across the whole deployment) with an optional admin
 * bypass. Never throws — any failure degrades to "no suggestions", which the
 * client already treats identically to today's plain no-match state.
 */
async function getVisionSuggestions(imageBuffer: Buffer, adminHeaderValue: string | undefined) {
  const dateKey = new Date().toISOString().slice(0, 10);
  const adminKey = process.env.VISION_ADMIN_KEY;
  const isAdminBypass = Boolean(adminKey) && adminHeaderValue === adminKey;

  const count = incrementVisionCallCount(dateKey);
  const limit = Number(process.env.VISION_DAILY_LIMIT ?? DEFAULT_VISION_DAILY_LIMIT);
  if (!isAdminBypass && count > limit) {
    return [];
  }

  try {
    const [topGuess] = await identifyVinyl(imageBuffer);
    if (!topGuess) return [];

    const appName = process.env.MUSICBRAINZ_APP_NAME ?? 'sleevesnap';
    return await searchReleasesByText(`${topGuess.artist} ${topGuess.title}`, appName, VALIDATION_SEARCH_LIMIT);
  } catch (err) {
    console.warn('[scan] Vision-assisted identification failed:', err);
    return [];
  }
}



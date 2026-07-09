import { Router } from 'express';
import { db, incrementVisionCallCount } from '../db.js';
import { computeHash, hammingDistance } from '../imageHash.js';
import { logEvent, logWarn, newRequestId } from '../logger.js';
import { identifyVinyl, VisionScanResult } from '../services/visionProvider/index.js';
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

interface VisionSuggestionsResult {
  suggestions: unknown[];
  vision?: {
    guesses: VisionScanResult[];
    suggestedQuery?: string;
  };
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
  const requestId = newRequestId();
  const startedAt = Date.now();
  const { base64Image } = req.body;

  if (!base64Image || typeof base64Image !== 'string') {
    logEvent('scan', requestId, 'Rejected: base64Image missing or not a string');
    res.status(400).json({ error: 'base64Image is required' });
    return;
  }

  let imageBuffer: Buffer;
  try {
    imageBuffer = Buffer.from(base64Image, 'base64');
  } catch {
    logEvent('scan', requestId, 'Rejected: invalid base64 image data');
    res.status(400).json({ error: 'Invalid base64 image data' });
    return;
  }

  logEvent('scan', requestId, 'Image received', {
    bytes: imageBuffer.length,
    approxKB: Math.round(imageBuffer.length / 1024),
  });

  let scanHash: string;
  try {
    scanHash = await computeHash(imageBuffer);
  } catch (err) {
    logWarn('scan', requestId, 'Failed to hash image — upload rejected', { error: String(err) });
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
    logEvent('scan', requestId, 'Matched existing collection item', {
      recordId: bestMatch.id,
      artist: bestMatch.artist,
      title: bestMatch.title,
      distance: bestDistance,
      scannedRows: rows.length,
      totalMs: Date.now() - startedAt,
    });
    res.json({ matched: true, record: rowToRecord(bestMatch) });
    return;
  }

  logEvent('scan', requestId, 'No local collection match', {
    scannedRows: rows.length,
    bestDistance: Number.isFinite(bestDistance) ? bestDistance : null,
    threshold: MATCH_THRESHOLD,
  });

  const visionResult = await getVisionSuggestions(imageBuffer, req.header('x-vision-admin-key'), requestId);

  logEvent('scan', requestId, 'Request complete', {
    matched: false,
    suggestionCount: visionResult.suggestions.length,
    visionGuessCount: visionResult.vision?.guesses.length ?? 0,
    totalMs: Date.now() - startedAt,
  });
  if (visionResult.suggestions.length > 0 || visionResult.vision) {
    res.json({
      matched: false,
      suggestions: visionResult.suggestions.length > 0 ? visionResult.suggestions : undefined,
      vision: visionResult.vision,
    });
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
async function getVisionSuggestions(
  imageBuffer: Buffer,
  adminHeaderValue: string | undefined,
  requestId: string,
): Promise<VisionSuggestionsResult> {
  const dateKey = new Date().toISOString().slice(0, 10);
  const adminKey = process.env.VISION_ADMIN_KEY;
  const isAdminBypass = Boolean(adminKey) && adminHeaderValue === adminKey;

  const count = incrementVisionCallCount(dateKey);
  const limit = Number(process.env.VISION_DAILY_LIMIT ?? DEFAULT_VISION_DAILY_LIMIT);

  logEvent('scan', requestId, 'Vision daily cap check', { count, limit, dateKey, adminBypass: isAdminBypass });

  if (!isAdminBypass && count > limit) {
    logEvent('scan', requestId, 'Vision call skipped — daily cap reached');
    return { suggestions: [] };
  }

  try {
    const visionStartedAt = Date.now();
    const guesses = await identifyVinyl(imageBuffer, requestId);
    logEvent('scan', requestId, 'Vision guesses received', {
      guessCount: guesses.length,
      top: guesses[0],
      ms: Date.now() - visionStartedAt,
    });

    const [topGuess] = guesses;
    if (!topGuess) {
      logEvent('scan', requestId, 'No vision suggestion available — client will fall back to manual search');
      return { suggestions: [] };
    }

    const appName = process.env.MUSICBRAINZ_APP_NAME ?? 'sleevesnap';
    const validationQuery = `${topGuess.artist} ${topGuess.title}`;
    const validated = await searchReleasesByText(validationQuery, appName, VALIDATION_SEARCH_LIMIT);

    if (validated.length === 0) {
      logEvent(
        'scan',
        requestId,
        'Vision guess did NOT validate — MusicBrainz returned no vinyl-format match for this query',
        { query: validationQuery, guess: topGuess },
      );
    } else {
      logEvent('scan', requestId, 'Vision guess validated against MusicBrainz', {
        query: validationQuery,
        matchCount: validated.length,
        top: `${validated[0]!.artist} - ${validated[0]!.title}`,
      });
    }

    return {
      suggestions: validated,
      vision: {
        guesses,
        suggestedQuery: validationQuery,
      },
    };
  } catch (err) {
    logWarn('scan', requestId, 'Vision-assisted identification failed', { error: String(err) });
    return { suggestions: [] };
  }
}

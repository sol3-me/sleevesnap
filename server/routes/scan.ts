import { Router } from 'express';
import { db, getVisionCallCount, incrementVisionCallCount } from '../db.js';
import { computeHash, hammingDistance } from '../imageHash.js';
import { logEvent, logWarn, newRequestId } from '../logger.js';
import { identifyVinyl, VisionScanResult } from '../services/visionProvider/index.js';
import { searchGroupsByIntent } from './search.js';

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

type ValidatedGroup = Awaited<ReturnType<typeof searchGroupsByIntent>>['groups'][number];

interface ValidatedGuess extends VisionScanResult {
  /** True when a structured MusicBrainz release-group search found at least one match for this guess. */
  validated: boolean;
  /** The release groups that search found (empty when not validated). */
  matchedGroups: ValidatedGroup[];
}

interface VisionSuggestionsResult {
  vision?: {
    guesses: ValidatedGuess[];
    suggestedQuery?: string;
  };
  /** True when the AI determined the photo does not show a record sleeve at all. */
  notAlbumCover?: boolean;
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
  const uid = req.user?.uid;
  if (!uid) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
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

  // Retrieve the requesting user's collection items that have a stored hash —
  // never match against other users' collections, both for correctness (it's
  // not *their* copy) and so no other user's metadata can leak into a scan.
  const rows = db
    .prepare('SELECT * FROM collection WHERE user_id = ? AND phash IS NOT NULL')
    .all(uid) as CollectionRow[];

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
    notAlbumCover: Boolean(visionResult.notAlbumCover),
    visionGuessCount: visionResult.vision?.guesses.length ?? 0,
    validatedGuessCount: visionResult.vision?.guesses.filter((g) => g.validated).length ?? 0,
    totalMs: Date.now() - startedAt,
  });
  if (visionResult.notAlbumCover) {
    res.json({ matched: false, notAlbumCover: true });
  } else if (visionResult.vision) {
    res.json({ matched: false, vision: visionResult.vision });
  } else {
    res.json({ matched: false });
  }
});

const DEFAULT_VISION_DAILY_LIMIT = 5;
const VALIDATION_GROUP_LIMIT = 3;
const DEFAULT_VALIDATION_GUESSES = 3;

/**
 * GET /api/scan/quota
 *
 * Read-only view of today's AI-scan allowance, for the client to show the
 * user how many scans they have left — never increments the counter.
 */
scanRouter.get('/quota', (_req, res) => {
  const dateKey = new Date().toISOString().slice(0, 10);
  const used = getVisionCallCount(dateKey);
  const limit = Number(process.env.VISION_DAILY_LIMIT ?? DEFAULT_VISION_DAILY_LIMIT);
  const remaining = Math.max(0, limit - used);
  res.json({ used, limit, remaining });
});

/**
 * Runs the vision-assisted identification + MusicBrainz validation flow for
 * a photo that didn't match anything in the collection. Enforces a global
 * daily cap on vision-provider calls (deliberately shared across all users —
 * it exists to bound the deployment's total vision-API spend, not to ration
 * fairly per user) with an optional admin bypass. Never throws — any failure degrades to "no suggestions", which the
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
    return {};
  }

  try {
    const visionStartedAt = Date.now();
    const identifyResult = await identifyVinyl(imageBuffer, requestId);
    logEvent('scan', requestId, 'Vision guesses received', {
      isAlbumCover: identifyResult.isAlbumCover,
      guessCount: identifyResult.guesses.length,
      top: identifyResult.guesses[0],
      ms: Date.now() - visionStartedAt,
    });

    if (!identifyResult.isAlbumCover) {
      logEvent('scan', requestId, 'AI declined — photo does not appear to show a record sleeve; skipping validation searches');
      return { notAlbumCover: true };
    }

    const guesses = identifyResult.guesses;
    const [topGuess] = guesses;
    if (!topGuess) {
      logEvent('scan', requestId, 'No vision suggestion available — client will fall back to manual search');
      return {};
    }

    const validationGuessLimit = Math.max(
      1,
      Number(process.env.VISION_VALIDATION_GUESSES ?? DEFAULT_VALIDATION_GUESSES),
    );

    // Validate every guess with the same structured (indexed) release-group
    // search the user's own advanced search runs — a flat "artist title"
    // string match here previously produced both false negatives (word-order
    // noise) and false positives (title words matching the artist index).
    // Searches run in parallel; a failure degrades that one guess to
    // unvalidated rather than sinking the whole scan.
    const validatedGuesses: ValidatedGuess[] = await Promise.all(
      guesses.map(async (guess, index): Promise<ValidatedGuess> => {
        if (index >= validationGuessLimit) {
          return { ...guess, validated: false, matchedGroups: [] };
        }
        try {
          const result = await searchGroupsByIntent(
            { artist: guess.artist, title: guess.title },
            VALIDATION_GROUP_LIMIT,
          );
          const validated = result.groups.length > 0;
          logEvent('scan', requestId, validated
            ? 'Vision guess validated against MusicBrainz'
            : 'Vision guess did NOT validate — no release group matched', {
            guess: `${guess.artist} - ${guess.title}`,
            confidence: guess.confidence,
            matchCount: result.groups.length,
            top: result.groups[0] ? `${result.groups[0].artist} - ${result.groups[0].title}` : undefined,
          });
          return { ...guess, validated, matchedGroups: result.groups };
        } catch (err) {
          logWarn('scan', requestId, 'Vision guess validation search failed — treating as unvalidated', {
            guess: `${guess.artist} - ${guess.title}`,
            error: String(err),
          });
          return { ...guess, validated: false, matchedGroups: [] };
        }
      }),
    );

    return {
      vision: {
        guesses: validatedGuesses,
        suggestedQuery: `${topGuess.artist} ${topGuess.title}`,
      },
    };
  } catch (err) {
    logWarn('scan', requestId, 'Vision-assisted identification failed', { error: String(err) });
    return {};
  }
}

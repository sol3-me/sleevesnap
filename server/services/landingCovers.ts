import { db } from '../db.js';
import { fetchAndStoreAlbumCover } from './coverFetcher.js';
import { LANDING_POOL, type LandingPoolEntry } from './landingPool.js';
import { createThumbnail } from './thumbnail.js';
import type { BlobStorageProvider } from '../storage/BlobStorageProvider.js';

export type LandingCover = { url: string; artist: string; album: string };

/** A warmed pool cover: the full-res url plus its web-optimized thumbnail. */
export type WarmedCover = { coverUrl: string; thumbUrl: string };

/** Same key format the covers route writes, so both share one cache. */
export function coverCacheKey(artist: string, album: string): string {
  return `${artist.toLowerCase()}::${album.toLowerCase()}`;
}

/**
 * Picks `count` distinct items uniformly at random (partial Fisher-Yates).
 * Returns everything (shuffled) when `count` exceeds the input size.
 */
export function pickRandomCovers<T>(
  items: readonly T[],
  count: number,
  random: () => number = Math.random,
): T[] {
  const copy = [...items];
  const n = Math.min(Math.max(count, 0), copy.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

/**
 * Random selection of landing-pool covers that are already in cover_cache.
 * Returns the web-optimized thumbnail url when present (falling back to the
 * full-res cover for any entry not yet thumbnailed). Cache rows outside the
 * pool (user-driven cover lookups) are never exposed.
 */
export function getCachedLandingCovers(
  count: number,
  random: () => number = Math.random,
): LandingCover[] {
  const keys = LANDING_POOL.map((entry) => coverCacheKey(entry.artist, entry.album));
  const placeholders = keys.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT cache_key, cover_url, thumb_url FROM cover_cache WHERE cache_key IN (${placeholders})`,
    )
    .all(...keys) as Array<{ cache_key: string; cover_url: string; thumb_url: string | null }>;

  const rowByKey = new Map(rows.map((row) => [row.cache_key, row]));
  const cached: LandingCover[] = [];
  for (const entry of LANDING_POOL) {
    const row = rowByKey.get(coverCacheKey(entry.artist, entry.album));
    if (row) {
      cached.push({ url: row.thumb_url ?? row.cover_url, artist: entry.artist, album: entry.album });
    }
  }

  return pickRandomCovers(cached, count, random);
}

/**
 * Warms one pool entry to a full cover + thumbnail. Reuses an already-stored
 * full cover (`existingCoverUrl`) so re-runs only generate a missing
 * thumbnail without re-hitting MusicBrainz; otherwise fetches the cover
 * first. Returns null when no cover can be found.
 */
export async function warmLandingCover(
  artist: string,
  album: string,
  existingCoverUrl: string | null,
  storage: BlobStorageProvider,
): Promise<WarmedCover | null> {
  const coverUrl = existingCoverUrl ?? (await fetchAndStoreAlbumCover(artist, album, storage));
  if (!coverUrl) return null;

  // Full-res covers are stored under a key beneath the /covers/ route; derive
  // it to read the bytes back and write a sibling thumbnail. On any failure
  // fall back to the full-res url so the wall still shows the cover.
  let thumbUrl = coverUrl;
  const key = coverUrl.split('/covers/')[1];
  if (key) {
    try {
      const original = await storage.get(key);
      if (original) {
        const thumb = await createThumbnail(original);
        const thumbKey = key.replace(/(\.[a-z0-9]+)?$/i, '-w256.jpg');
        thumbUrl = await storage.put(thumbKey, thumb, 'image/jpeg');
      }
    } catch (err) {
      console.error(`[landing] Failed to thumbnail ${artist} - ${album}:`, err);
    }
  }

  return { coverUrl, thumbUrl };
}

/**
 * Warms pool entries that lack a thumbnail, pausing `delayMs` only when an
 * entry actually needs a network fetch (MusicBrainz allows ~1 request/second)
 * — thumbnailing an already-stored cover is local and needs no pause.
 * Per-entry failures are logged and skipped so one flaky entry can't stall
 * the rest of the pool.
 */
export async function warmLandingCovers(
  pool: readonly LandingPoolEntry[],
  warmOne: (artist: string, album: string, existingCoverUrl: string | null) => Promise<WarmedCover | null>,
  delayMs: number,
): Promise<void> {
  for (const entry of pool) {
    const key = coverCacheKey(entry.artist, entry.album);
    const row = db.prepare('SELECT cover_url, thumb_url FROM cover_cache WHERE cache_key = ?').get(key) as
      | { cover_url: string; thumb_url: string | null }
      | undefined;
    if (row?.thumb_url) continue; // already fully warmed with a thumbnail

    const hadFullCover = Boolean(row?.cover_url);
    try {
      const result = await warmOne(entry.artist, entry.album, row?.cover_url ?? null);
      if (result) {
        db.prepare(
          'INSERT OR REPLACE INTO cover_cache (cache_key, cover_url, thumb_url, fetched_at) VALUES (?, ?, ?, ?)',
        ).run(key, result.coverUrl, result.thumbUrl, Date.now());
      }
    } catch (err) {
      console.error(`[landing] Failed to warm cover for ${entry.artist} - ${entry.album}:`, err);
    }

    // Only rate-limit real MusicBrainz/CAA fetches, not local thumbnailing.
    if (!hadFullCover && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

let warmupStarted = false;

/**
 * Fire-and-forget warmup of the full landing pool; runs at most once per
 * process. Called from the landing route so the pool fills lazily on first
 * visit instead of blocking server startup.
 */
export function startLandingWarmup(storage: BlobStorageProvider, delayMs = 1200): void {
  if (warmupStarted) return;
  warmupStarted = true;
  void warmLandingCovers(
    LANDING_POOL,
    (artist, album, existingCoverUrl) => warmLandingCover(artist, album, existingCoverUrl, storage),
    delayMs,
  );
}

import { db } from '../db.js';
import { fetchAndStoreCover } from './coverFetcher.js';
import { LANDING_POOL, type LandingPoolEntry } from './landingPool.js';
import type { BlobStorageProvider } from '../storage/BlobStorageProvider.js';

export type LandingCover = { url: string; artist: string; album: string };

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
 * Cache rows outside the pool (user-driven cover lookups) are never exposed.
 */
export function getCachedLandingCovers(
  count: number,
  random: () => number = Math.random,
): LandingCover[] {
  const keys = LANDING_POOL.map((entry) => coverCacheKey(entry.artist, entry.album));
  const placeholders = keys.map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT cache_key, cover_url FROM cover_cache WHERE cache_key IN (${placeholders})`)
    .all(...keys) as Array<{ cache_key: string; cover_url: string }>;

  const urlByKey = new Map(rows.map((row) => [row.cache_key, row.cover_url]));
  const cached: LandingCover[] = [];
  for (const entry of LANDING_POOL) {
    const url = urlByKey.get(coverCacheKey(entry.artist, entry.album));
    if (url) cached.push({ url, artist: entry.artist, album: entry.album });
  }

  return pickRandomCovers(cached, count, random);
}

/**
 * Sequentially fetches covers for pool entries missing from cover_cache,
 * pausing `delayMs` between entries (MusicBrainz allows ~1 request/second).
 * Per-entry failures are logged and skipped so one flaky lookup can't stall
 * the rest of the pool.
 */
export async function warmLandingCovers(
  pool: readonly LandingPoolEntry[],
  fetchCover: (artist: string, album: string) => Promise<string | null>,
  delayMs: number,
): Promise<void> {
  for (const entry of pool) {
    const key = coverCacheKey(entry.artist, entry.album);
    const cached = db.prepare('SELECT 1 FROM cover_cache WHERE cache_key = ?').get(key);
    if (cached) continue;

    try {
      const url = await fetchCover(entry.artist, entry.album);
      if (url) {
        db.prepare(
          'INSERT OR REPLACE INTO cover_cache (cache_key, cover_url, fetched_at) VALUES (?, ?, ?)',
        ).run(key, url, Date.now());
      }
    } catch (err) {
      console.error(`[landing] Failed to warm cover for ${entry.artist} - ${entry.album}:`, err);
    }

    if (delayMs > 0) {
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
    (artist, album) => fetchAndStoreCover(artist, album, storage),
    delayMs,
  );
}

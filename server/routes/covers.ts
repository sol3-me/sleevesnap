import { Router, type Request, type Response } from 'express';
import { db } from '../db.js';
import { fetchAndStoreCover } from '../services/coverFetcher.js';
import type { BlobStorageProvider } from '../storage/BlobStorageProvider.js';

/**
 * Creates the covers API router.
 *
 * @param storage - The BlobStorageProvider used to persist downloaded cover art
 *                  and make it available via a public URL.
 */
export function createCoversRouter(storage: BlobStorageProvider): Router {
  const router = Router();

  /**
   * GET /api/covers?artist=<artist>&album=<album>
   *
   * Fetches a cover image for the given artist + album combination.
   * On cache hit  → returns the stored cover URL immediately.
   * On cache miss → queries MusicBrainz / Cover Art Archive, downloads the
   *                 image, persists it via the BlobStorageProvider, caches the
   *                 resulting URL in SQLite, and returns it.
   */
  router.get('/', async (req: Request, res: Response) => {
    const { artist, album } = req.query;

    if (!artist || !album || typeof artist !== 'string' || typeof album !== 'string') {
      res.status(400).json({ error: 'artist and album query parameters are required' });
      return;
    }

    const cacheKey = `${artist.toLowerCase()}::${album.toLowerCase()}`;

    // Cache hit
    const cached = db
      .prepare('SELECT cover_url FROM cover_cache WHERE cache_key = ?')
      .get(cacheKey) as { cover_url: string } | undefined;

    if (cached) {
      res.json({ coverUrl: cached.cover_url });
      return;
    }

    // Cache miss – fetch from MusicBrainz / Cover Art Archive
    try {
      const coverUrl = await fetchAndStoreCover(artist, album, storage);
      if (coverUrl) {
        db.prepare(
          'INSERT OR REPLACE INTO cover_cache (cache_key, cover_url, fetched_at) VALUES (?, ?, ?)',
        ).run(cacheKey, coverUrl, Date.now());
        res.json({ coverUrl });
      } else {
        res.json({ coverUrl: null });
      }
    } catch (err) {
      console.error('[covers] Error fetching cover:', err);
      res.status(502).json({ error: 'Failed to fetch cover art' });
    }
  });

  return router;
}

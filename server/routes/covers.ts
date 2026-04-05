import { Router, type Request, type Response } from 'express';
import { db } from '../db.js';
import type { BlobStorageProvider } from '../storage/BlobStorageProvider.js';

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

/**
 * Look up a release on MusicBrainz, download the front cover from Cover Art
 * Archive, store it via the provided BlobStorageProvider, and return the
 * public URL.  Returns null if no cover is found.
 */
async function fetchAndStoreCover(
  artist: string,
  album: string,
  storage: BlobStorageProvider,
): Promise<string | null> {
  const appName = process.env.MUSICBRAINZ_APP_NAME ?? 'sleevesnap';

  // Step 1: Find the release MBID via MusicBrainz search
  const mbSearchUrl = new URL('https://musicbrainz.org/ws/2/release');
  mbSearchUrl.searchParams.set('query', `artist:"${artist}" release:"${album}"`);
  mbSearchUrl.searchParams.set('fmt', 'json');
  mbSearchUrl.searchParams.set('limit', '1');

  const mbRes = await fetch(mbSearchUrl.toString(), {
    headers: {
      'User-Agent': `${appName}/1.0 (https://github.com/sol3uk/sleevesnap)`,
    },
  });

  if (!mbRes.ok) return null;

  const mbData = (await mbRes.json()) as {
    releases?: Array<{ id: string; score: number }>;
  };

  const releases = mbData.releases ?? [];
  if (releases.length === 0) return null;

  const mbid = releases[0].id;

  // Step 2: Fetch cover art from Cover Art Archive
  const caaRes = await fetch(`https://coverartarchive.org/release/${mbid}/front`, {
    redirect: 'follow',
    headers: { 'User-Agent': `${appName}/1.0` },
  });

  if (!caaRes.ok) return null;

  const contentType = caaRes.headers.get('content-type') ?? 'image/jpeg';
  const arrayBuffer = await caaRes.arrayBuffer();
  const imageBuffer = Buffer.from(arrayBuffer);

  // Step 3: Store via BlobStorageProvider
  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const key = `covers/${mbid}.${ext}`;
  const coverUrl = await storage.put(key, imageBuffer, contentType);

  return coverUrl;
}

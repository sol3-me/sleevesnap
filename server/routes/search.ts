import { Router } from 'express';

export const searchRouter = Router();

interface MusicBrainzRelease {
  id: string;
  title: string;
  date?: string;
  'artist-credit'?: Array<{ artist?: { name?: string } }>;
  'release-group'?: { 'primary-type'?: string };
  tags?: Array<{ name: string; count: number }>;
}

interface MusicBrainzSearchResponse {
  releases?: MusicBrainzRelease[];
}

// POST /api/search  – search for vinyl records via the MusicBrainz API (free, no key required)
searchRouter.post('/', async (req, res) => {
  const { query } = req.body;

  if (!query || typeof query !== 'string') {
    res.status(400).json({ error: 'query is required' });
    return;
  }

  const appName = process.env.MUSICBRAINZ_APP_NAME ?? 'sleevesnap';

  try {
    const url = new URL('https://musicbrainz.org/ws/2/release');
    url.searchParams.set('query', query);
    url.searchParams.set('fmt', 'json');
    url.searchParams.set('limit', '5');
    // Prefer vinyl/LP releases
    url.searchParams.set('type', 'album');

    const mbRes = await fetch(url.toString(), {
      headers: {
        'User-Agent': `${appName}/1.0 (https://github.com/sol3uk/sleevesnap)`,
        Accept: 'application/json',
      },
    });

    if (!mbRes.ok) {
      console.error('[search] MusicBrainz error:', mbRes.status);
      res.status(502).json({ error: 'MusicBrainz search failed' });
      return;
    }

    const data = (await mbRes.json()) as MusicBrainzSearchResponse;
    const releases = data.releases ?? [];

    const results = releases.map((release, index) => {
      const artist =
        release['artist-credit']?.[0]?.artist?.name ?? 'Unknown Artist';
      const year = release.date ? release.date.slice(0, 4) : undefined;
      const genre =
        release['release-group']?.['primary-type'] ??
        release.tags?.[0]?.name ??
        undefined;

      return {
        id: `search-${Date.now()}-${index}`,
        artist,
        title: release.title,
        year,
        genre,
        dateAdded: Date.now(),
        coverUrl: `https://coverartarchive.org/release/${release.id}/front-250`,
        notes: `MusicBrainz ID: ${release.id}`,
      };
    });

    res.json(results);
  } catch (err) {
    console.error('[search] Error querying MusicBrainz:', err);
    res.status(502).json({ error: 'Failed to search records' });
  }
});


import type { BlobStorageProvider } from '../storage/BlobStorageProvider.js';

/**
 * Album-level cover lookup via MusicBrainz release groups: Cover Art
 * Archive serves a release group's canonical front image, which is far
 * more reliable for well-known albums than the top release search hit
 * (often a promo or digital release with no art). Falls back to the
 * release-level lookup, and returns null if neither finds a cover.
 */
export async function fetchAndStoreAlbumCover(
  artist: string,
  album: string,
  storage: BlobStorageProvider,
): Promise<string | null> {
  const appName = process.env.MUSICBRAINZ_APP_NAME ?? 'sleevesnap';

  const mbSearchUrl = new URL('https://musicbrainz.org/ws/2/release-group');
  mbSearchUrl.searchParams.set(
    'query',
    `artist:"${artist}" AND releasegroup:"${album}" AND primarytype:Album`,
  );
  mbSearchUrl.searchParams.set('fmt', 'json');
  mbSearchUrl.searchParams.set('limit', '1');

  const mbRes = await fetch(mbSearchUrl.toString(), {
    headers: {
      'User-Agent': `${appName}/1.0 (https://github.com/sol3uk/sleevesnap)`,
    },
  });

  if (mbRes.ok) {
    const mbData = (await mbRes.json()) as {
      'release-groups'?: Array<{ id: string; score: number }>;
    };
    const releaseGroups = mbData['release-groups'] ?? [];

    if (releaseGroups.length > 0) {
      const rgid = releaseGroups[0].id;
      const caaRes = await fetch(`https://coverartarchive.org/release-group/${rgid}/front`, {
        redirect: 'follow',
        headers: { 'User-Agent': `${appName}/1.0` },
      });

      if (caaRes.ok) {
        const contentType = caaRes.headers.get('content-type') ?? 'image/jpeg';
        const imageBuffer = Buffer.from(await caaRes.arrayBuffer());
        const ext = contentType.includes('png') ? 'png' : 'jpg';
        return await storage.put(`covers/rg-${rgid}.${ext}`, imageBuffer, contentType);
      }
    }
  }

  return fetchAndStoreCover(artist, album, storage);
}

/**
 * Look up a release on MusicBrainz, download the front cover from Cover Art
 * Archive, store it via the provided BlobStorageProvider, and return the
 * public URL.  Returns null if no cover is found.
 */
export async function fetchAndStoreCover(
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

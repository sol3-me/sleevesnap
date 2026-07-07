import { Router } from 'express';

export const searchRouter = Router();

const DEFAULT_GROUP_PAGE_SIZE = 5;
const MAX_GROUP_PAGE_SIZE = 5;
const RELEASE_LIMIT_PER_GROUP = 100;
const FLAT_SEARCH_LIMIT = 15;
const RELEASE_SEARCH_BATCH_SIZE = 100;
const MAX_RELEASES_TO_SCAN = 3000;
const MIN_RELEASES_TO_SCAN = 800;

type SearchFormat = 'vinyl' | 'cd';

interface MusicBrainzArtistCredit {
  name?: string;
  artist?: { name?: string };
}

interface MusicBrainzSearchResponse {
  count?: number;
  offset?: number;
  releases?: MusicBrainzRelease[];
}

interface MusicBrainzRelease {
  id: string;
  title: string;
  date?: string;
  country?: string;
  status?: string;
  disambiguation?: string;
  media?: Array<{ format?: string }>;
  'artist-credit'?: Array<{ artist?: { name?: string } }>;
  'release-group'?: { id?: string; title?: string; 'primary-type'?: string };
  tags?: Array<{ name: string; count: number }>;
}

interface MusicBrainzUrlRelation {
  type?: string;
  url?: { resource?: string };
}

interface MusicBrainzReleaseGroupDetailsResponse {
  relations?: MusicBrainzUrlRelation[];
}

interface AggregatedSearchGroup {
  releaseGroupId: string;
  title: string;
  artist: string;
  firstReleaseDate?: string;
  releaseGroupUrl: string;
  thumbnailUrl?: string;
  availableFormats: string[];
  totalReleases: number;
}

interface SearchReleaseResult {
  id: string;
  artist: string;
  title: string;
  year?: string;
  releaseDate?: string;
  genre?: string;
  format?: string;
  country?: string;
  releaseStatus?: string;
  edition?: string;
  musicBrainzId?: string;
  releaseGroupId?: string;
  releaseGroupTitle?: string;
  releaseGroupUrl?: string;
  releaseUrl?: string;
  thumbnailUrl?: string;
  coverUrl?: string;
  dateAdded: number;
  notes?: string;
}

// POST /api/search  – flat search list (kept for scanner compatibility)
searchRouter.post('/', async (req, res) => {
  const { query, includeOtherFormats } = req.body as {
    query?: string;
    includeOtherFormats?: boolean;
  };

  if (!query || typeof query !== 'string') {
    res.status(400).json({ error: 'query is required' });
    return;
  }

  const appName = process.env.MUSICBRAINZ_APP_NAME ?? 'sleevesnap';

  try {
    const releases = await fetchReleasesByText(query, appName, FLAT_SEARCH_LIMIT);
    const mapped = releases
      .map((release) => mapRelease(release))
      .filter((release) => Boolean(includeOtherFormats) || isVinylFormat(release.format));
    res.json(mapped);
  } catch (err) {
    console.error('[search] Error querying MusicBrainz:', err);
    res.status(502).json({ error: 'Failed to search records' });
  }
});

// POST /api/search/groups  – grouped by release group for the Discover view
searchRouter.post('/groups', async (req, res) => {
  const { query, page, pageSize, formats } = req.body as {
    query?: string;
    page?: number;
    pageSize?: number;
    formats?: string[];
  };

  if (!query || typeof query !== 'string') {
    res.status(400).json({ error: 'query is required' });
    return;
  }

  const appName = process.env.MUSICBRAINZ_APP_NAME ?? 'sleevesnap';

  try {
    const safePage = Math.max(1, Number(page ?? 1));
    const safePageSize = Math.max(
      1,
      Math.min(MAX_GROUP_PAGE_SIZE, Number(pageSize ?? DEFAULT_GROUP_PAGE_SIZE)),
    );
    const selectedFormats = normalizeRequestedFormats(formats);

    if (selectedFormats.length === 0) {
      res.json({
        query,
        page: safePage,
        pageSize: safePageSize,
        total: 0,
        hasMore: false,
        isTotalExact: true,
        groups: [],
      });
      return;
    }

    const targetGroupsNeeded = safePage * safePageSize + 1;
    const maxReleasesToScan = getReleaseScanLimit(targetGroupsNeeded);

    const groupedResult = await collectFilteredReleaseGroups(
      query,
      appName,
      selectedFormats,
      targetGroupsNeeded,
      maxReleasesToScan,
    );

    const start = (safePage - 1) * safePageSize;
    const end = start + safePageSize;
    const pageGroups = groupedResult.groups.slice(start, end);

    const groups = await Promise.all(
      pageGroups.map(async (group) => ({
        ...group,
        discogsMasterUrl: await fetchReleaseGroupDiscogsMasterUrl(group.releaseGroupId, appName),
      })),
    );

    const hasMore = groupedResult.isComplete
      ? end < groupedResult.groups.length
      : true;

    res.json({
      query,
      page: safePage,
      pageSize: safePageSize,
      total: groupedResult.groups.length,
      hasMore,
      isTotalExact: groupedResult.isComplete,
      groups,
    });
  } catch (err) {
    console.error('[search/groups] Error querying MusicBrainz:', err);
    res.status(502).json({ error: 'Failed to search records' });
  }
});

// GET /api/search/groups/:releaseGroupId/releases  – lazy-loaded release list for one group
searchRouter.get('/groups/:releaseGroupId/releases', async (req, res) => {
  const { releaseGroupId } = req.params;
  const appName = process.env.MUSICBRAINZ_APP_NAME ?? 'sleevesnap';

  if (!releaseGroupId) {
    res.status(400).json({ error: 'releaseGroupId is required' });
    return;
  }

  try {
    const [releases, discogsMasterUrl] = await Promise.all([
      fetchReleasesByGroupId(releaseGroupId, appName),
      fetchReleaseGroupDiscogsMasterUrl(releaseGroupId, appName),
    ]);
    const mapped = releases.map((release) => mapRelease(release, releaseGroupId));

    const availableFormats = Array.from(
      new Set(
        mapped
          .map((release) => release.format)
          .filter((format): format is string => Boolean(format)),
      ),
    );

    res.json({
      releaseGroupId,
      availableFormats,
      discogsMasterUrl,
      releases: mapped,
    });
  } catch (err) {
    console.error('[search/groups/:id/releases] Error querying MusicBrainz:', err);
    res.status(502).json({ error: 'Failed to load release group releases' });
  }
});

/**
 * Searches MusicBrainz by free-text query and returns vinyl-format results,
 * mirroring the filtering behaviour of `POST /` above. Exported for reuse by
 * the vision-assisted scan flow to validate an AI guess.
 */
export async function searchReleasesByText(
  query: string,
  appName: string,
  limit: number,
): Promise<SearchReleaseResult[]> {
  const releases = await fetchReleasesByText(query, appName, limit);
  return releases
    .map((release) => mapRelease(release))
    .filter((release) => isVinylFormat(release.format));
}

function normalizeRequestedFormats(rawFormats: string[] | undefined): SearchFormat[] {
  if (!Array.isArray(rawFormats)) {
    return ['vinyl'];
  }

  const unique = new Set<SearchFormat>();
  for (const raw of rawFormats) {
    const normalized = raw?.toLowerCase();
    if (normalized === 'vinyl' || normalized === 'cd') {
      unique.add(normalized);
    }
  }

  return Array.from(unique);
}

function getReleaseScanLimit(targetGroupsNeeded: number): number {
  const computed = targetGroupsNeeded * 120;
  return Math.min(MAX_RELEASES_TO_SCAN, Math.max(MIN_RELEASES_TO_SCAN, computed));
}

async function collectFilteredReleaseGroups(
  query: string,
  appName: string,
  selectedFormats: SearchFormat[],
  targetGroupsNeeded: number,
  maxReleasesToScan: number,
): Promise<{ groups: AggregatedSearchGroup[]; isComplete: boolean }> {
  const normalizedQuery = normalizeSearchInput(query);
  const exactQuery = buildExactSearchQuery(normalizedQuery);

  const exactResult = await collectFilteredReleaseGroupsByReleaseQuery(
    exactQuery,
    appName,
    selectedFormats,
    targetGroupsNeeded,
    maxReleasesToScan,
  );

  if (exactResult.groups.length >= targetGroupsNeeded || !normalizedQuery.includes(' ')) {
    return exactResult;
  }

  const fallbackQuery = buildFallbackSearchQuery(normalizedQuery);
  if (fallbackQuery === exactQuery) {
    return exactResult;
  }

  const fallbackResult = await collectFilteredReleaseGroupsByReleaseQuery(
    fallbackQuery,
    appName,
    selectedFormats,
    targetGroupsNeeded,
    maxReleasesToScan,
  );

  return {
    groups: mergeAggregatedGroups(exactResult.groups, fallbackResult.groups),
    isComplete: exactResult.isComplete && fallbackResult.isComplete,
  };
}

async function collectFilteredReleaseGroupsByReleaseQuery(
  releaseQuery: string,
  appName: string,
  selectedFormats: SearchFormat[],
  targetGroupsNeeded: number,
  maxReleasesToScan: number,
): Promise<{ groups: AggregatedSearchGroup[]; isComplete: boolean }> {
  const grouped = new Map<
    string,
    {
      releaseGroupId: string;
      title: string;
      artist: string;
      firstReleaseDate?: string;
      releaseGroupUrl: string;
      thumbnailUrl?: string;
      totalReleases: number;
      availableFormats: Set<string>;
    }
  >();

  let offset = 0;
  let totalReleases = Number.POSITIVE_INFINITY;
  let scanned = 0;

  while (
    scanned < maxReleasesToScan &&
    grouped.size < targetGroupsNeeded &&
    offset < totalReleases
  ) {
    const limit = Math.min(RELEASE_SEARCH_BATCH_SIZE, maxReleasesToScan - scanned);
    const releaseResponse = await fetchReleasesByQuery(releaseQuery, appName, limit, offset);
    totalReleases = releaseResponse.count ?? totalReleases;
    const releases = releaseResponse.releases ?? [];

    if (releases.length === 0) {
      totalReleases = Math.min(totalReleases, offset);
      break;
    }

    for (const release of releases) {
      const mapped = mapRelease(release);

      if (!mapped.releaseGroupId || !matchesRequestedFormat(mapped.format, selectedFormats)) {
        continue;
      }

      const existing = grouped.get(mapped.releaseGroupId);
      if (!existing) {
        grouped.set(mapped.releaseGroupId, {
          releaseGroupId: mapped.releaseGroupId,
          title: mapped.releaseGroupTitle ?? mapped.title,
          artist: mapped.artist,
          firstReleaseDate: mapped.releaseDate,
          releaseGroupUrl: mapped.releaseGroupUrl ?? `https://musicbrainz.org/release-group/${mapped.releaseGroupId}`,
          thumbnailUrl: mapped.thumbnailUrl,
          totalReleases: 1,
          availableFormats: new Set(mapped.format ? [mapped.format] : []),
        });
        continue;
      }

      existing.totalReleases += 1;
      if (mapped.format) {
        existing.availableFormats.add(mapped.format);
      }
      if (!existing.firstReleaseDate || isEarlierDate(mapped.releaseDate, existing.firstReleaseDate)) {
        existing.firstReleaseDate = mapped.releaseDate;
      }
      if (!existing.thumbnailUrl && mapped.thumbnailUrl) {
        existing.thumbnailUrl = mapped.thumbnailUrl;
      }
    }

    scanned += releases.length;
    offset += releases.length;

    if (releases.length < limit) {
      totalReleases = Math.min(totalReleases, offset);
      break;
    }
  }

  const isComplete = offset >= totalReleases;

  return {
    groups: Array.from(grouped.values()).map((group) => ({
      releaseGroupId: group.releaseGroupId,
      title: group.title,
      artist: group.artist,
      firstReleaseDate: group.firstReleaseDate,
      releaseGroupUrl: group.releaseGroupUrl,
      thumbnailUrl: group.thumbnailUrl,
      totalReleases: group.totalReleases,
      availableFormats: Array.from(group.availableFormats),
    })),
    isComplete,
  };
}

function matchesRequestedFormat(format: string | undefined, selectedFormats: SearchFormat[]): boolean {
  if (!format || selectedFormats.length === 0) return false;
  const lower = format.toLowerCase();
  const wantsVinyl = selectedFormats.includes('vinyl');
  const wantsCd = selectedFormats.includes('cd');

  return (
    (wantsVinyl && /vinyl|\blp\b/.test(lower)) ||
    (wantsCd && /\bcd\b/.test(lower))
  );
}

function isEarlierDate(candidate: string | undefined, existing: string | undefined): boolean {
  if (!candidate) return false;
  if (!existing) return true;
  return candidate < existing;
}

function mergeAggregatedGroups(
  primary: AggregatedSearchGroup[],
  secondary: AggregatedSearchGroup[],
): AggregatedSearchGroup[] {
  const merged = new Map<string, AggregatedSearchGroup>();

  const upsert = (group: AggregatedSearchGroup) => {
    const existing = merged.get(group.releaseGroupId);
    if (!existing) {
      merged.set(group.releaseGroupId, {
        ...group,
        availableFormats: Array.from(new Set(group.availableFormats)),
      });
      return;
    }

    const combinedFormats = Array.from(new Set([...existing.availableFormats, ...group.availableFormats]));

    merged.set(group.releaseGroupId, {
      ...existing,
      firstReleaseDate:
        !existing.firstReleaseDate || isEarlierDate(group.firstReleaseDate, existing.firstReleaseDate)
          ? group.firstReleaseDate ?? existing.firstReleaseDate
          : existing.firstReleaseDate,
      thumbnailUrl: existing.thumbnailUrl ?? group.thumbnailUrl,
      totalReleases: Math.max(existing.totalReleases, group.totalReleases),
      availableFormats: combinedFormats,
    });
  };

  for (const group of primary) upsert(group);
  for (const group of secondary) upsert(group);

  return Array.from(merged.values());
}

async function fetchReleasesByText(
  query: string,
  appName: string,
  limit: number,
): Promise<MusicBrainzRelease[]> {
  const data = await fetchReleasesByQuery(query.trim(), appName, limit, 0);
  return data.releases ?? [];
}

async function fetchReleasesByQuery(
  query: string,
  appName: string,
  limit: number,
  offset: number,
): Promise<MusicBrainzSearchResponse> {
  const url = new URL('https://musicbrainz.org/ws/2/release');
  url.searchParams.set('query', query);
  url.searchParams.set('fmt', 'json');
  url.searchParams.set('type', 'album');
  url.searchParams.set('inc', 'media');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));

  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': `${appName}/1.0 (https://github.com/sol3uk/sleevesnap)`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(`MusicBrainz release search failed (${res.status})`);
  }

  return (await res.json()) as MusicBrainzSearchResponse;
}

async function fetchReleasesByGroupId(
  releaseGroupId: string,
  appName: string,
): Promise<MusicBrainzRelease[]> {
  const url = new URL('https://musicbrainz.org/ws/2/release');
  url.searchParams.set('query', `rgid:${releaseGroupId}`);
  url.searchParams.set('fmt', 'json');
  url.searchParams.set('inc', 'media');
  url.searchParams.set('limit', String(RELEASE_LIMIT_PER_GROUP));

  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': `${appName}/1.0 (https://github.com/sol3uk/sleevesnap)`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) return [];

  const data = (await res.json()) as MusicBrainzSearchResponse;
  return data.releases ?? [];
}

async function fetchReleaseGroupDiscogsMasterUrl(
  releaseGroupId: string,
  appName: string,
): Promise<string | undefined> {
  const url = new URL(`https://musicbrainz.org/ws/2/release-group/${releaseGroupId}`);
  url.searchParams.set('fmt', 'json');
  url.searchParams.set('inc', 'url-rels');

  try {
    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': `${appName}/1.0 (https://github.com/sol3uk/sleevesnap)`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return undefined;
    }

    const data = (await res.json()) as MusicBrainzReleaseGroupDetailsResponse;
    return getDiscogsMasterUrlFromRelations(data.relations);
  } catch {
    return undefined;
  }
}

function mapRelease(
  release: MusicBrainzRelease,
  fallbackGroupId?: string,
): SearchReleaseResult {
  const artist = getArtistName(release['artist-credit']);
  const year = release.date ? release.date.slice(0, 4) : undefined;
  const genre =
    release['release-group']?.['primary-type'] ??
    release.tags?.[0]?.name ??
    undefined;
  const format = getReleaseFormat(release.media);
  const releaseGroupId = release['release-group']?.id ?? fallbackGroupId;

  return {
    id: `search-${release.id}`,
    artist,
    title: release.title,
    year,
    releaseDate: release.date,
    genre,
    format,
    country: release.country,
    releaseStatus: release.status,
    edition: release.disambiguation,
    musicBrainzId: release.id,
    releaseGroupId,
    releaseGroupTitle: release['release-group']?.title,
    releaseGroupUrl: releaseGroupId
      ? `https://musicbrainz.org/release-group/${releaseGroupId}`
      : undefined,
    releaseUrl: `https://musicbrainz.org/release/${release.id}`,
    thumbnailUrl: releaseGroupId
      ? `https://coverartarchive.org/release-group/${releaseGroupId}/front-250`
      : undefined,
    dateAdded: Date.now(),
    coverUrl: `https://coverartarchive.org/release/${release.id}/front-250`,
    notes: `MusicBrainz ID: ${release.id}`,
  };
}

function getReleaseFormat(media: Array<{ format?: string }> | undefined): string | undefined {
  if (!media?.length) return undefined;
  const formats = media
    .map((m) => m.format?.trim())
    .filter((format): format is string => Boolean(format));
  if (formats.length === 0) return undefined;
  return Array.from(new Set(formats)).join(' / ');
}

function isVinylFormat(format: string | undefined): boolean {
  if (!format) return false;
  return /vinyl|\blp\b/i.test(format);
}

function getArtistName(credits: MusicBrainzArtistCredit[] | undefined): string {
  return credits?.[0]?.artist?.name ?? credits?.[0]?.name ?? 'Unknown Artist';
}

function getDiscogsMasterUrlFromRelations(
  relations: MusicBrainzUrlRelation[] | undefined,
): string | undefined {
  if (!relations?.length) return undefined;

  const discogsUrls = relations
    .filter((relation) => relation.type?.toLowerCase() === 'discogs')
    .map((relation) => relation.url?.resource?.trim())
    .filter((resource): resource is string => Boolean(resource))
    .filter((resource) => /discogs\.com/i.test(resource));

  if (discogsUrls.length === 0) return undefined;

  return discogsUrls.find((resource) => /\/master\/\d+/i.test(resource));
}

function normalizeSearchInput(input: string): string {
  return input.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeLuceneTerm(term: string): string {
  return term.replace(/(\|\||&&|[+\-!(){}\[\]^"~*?:\\/])/g, '\\$1');
}

function buildExactSearchQuery(normalizedInput: string): string {
  const phrase = normalizedInput
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

  return `(releasegroup:"${phrase}" OR release:"${phrase}" OR artist:"${phrase}")`;
}

function buildFallbackSearchQuery(normalizedInput: string): string {
  const terms = normalizedInput
    .split(' ')
    .map((term) => escapeLuceneTerm(term.trim()))
    .filter((term) => Boolean(term));

  if (terms.length === 0) {
    return buildExactSearchQuery(normalizedInput);
  }

  if (terms.length === 1) {
    const [term] = terms;
    return `(releasegroup:${term} OR release:${term} OR artist:${term})`;
  }

  const allTerms = terms.join(' AND ');
  return `(releasegroup:(${allTerms}) OR release:(${allTerms}) OR artist:(${allTerms}))`;
}


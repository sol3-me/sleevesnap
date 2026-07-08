import { Router } from 'express';
import { logEvent, logWarn, newRequestId } from '../logger.js';

export const searchRouter = Router();

const DEFAULT_GROUP_PAGE_SIZE = 5;
const MAX_GROUP_PAGE_SIZE = 5;
const RELEASE_LIMIT_PER_GROUP = 100;
const FLAT_SEARCH_LIMIT = 15;
// How many raw release-group batches (each `pageSize` candidates) to try
// before giving up and returning a short, honestly-marked-inexact page.
// Scales naturally with pageSize since each round already requests
// `pageSize` candidates — no separate scan-budget bookkeeping needed.
const MAX_RAW_BATCHES_PER_PAGE = 3;

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

interface MusicBrainzReleaseGroupSearchResult {
  id: string;
  title: string;
  'first-release-date'?: string;
  'primary-type'?: string;
  'artist-credit'?: MusicBrainzArtistCredit[];
}

interface MusicBrainzReleaseGroupSearchResponse {
  count?: number;
  offset?: number;
  'release-groups'?: MusicBrainzReleaseGroupSearchResult[];
}

interface CandidateReleaseGroup {
  releaseGroupId: string;
  title: string;
  artist: string;
  firstReleaseDate?: string;
  releaseGroupUrl: string;
}

interface FilteredReleaseGroup extends CandidateReleaseGroup {
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
  const requestId = newRequestId();
  const startedAt = Date.now();
  const { query, includeOtherFormats } = req.body as {
    query?: string;
    includeOtherFormats?: boolean;
  };

  if (!query || typeof query !== 'string') {
    res.status(400).json({ error: 'query is required' });
    return;
  }

  logEvent('search', requestId, 'Manual search request', { query, includeOtherFormats: Boolean(includeOtherFormats) });

  const appName = process.env.MUSICBRAINZ_APP_NAME ?? 'sleevesnap';

  try {
    const releases = await fetchReleasesByText(query, appName, FLAT_SEARCH_LIMIT);
    const mapped = releases
      .map((release) => mapRelease(release))
      .filter((release) => Boolean(includeOtherFormats) || isVinylFormat(release.format));

    logEvent('search', requestId, 'Manual search results', {
      resultCount: mapped.length,
      top: mapped.slice(0, 3).map((r) => `${r.artist} - ${r.title}`),
      ms: Date.now() - startedAt,
    });

    res.json(mapped);
  } catch (err) {
    logWarn('search', requestId, 'Manual search failed', { query, error: String(err) });
    res.status(502).json({ error: 'Failed to search records' });
  }
});

// POST /api/search/groups  – grouped by release group for the Discover view
searchRouter.post('/groups', async (req, res) => {
  const requestId = newRequestId();
  const startedAt = Date.now();
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

    logEvent('search', requestId, 'Discover search request', {
      query,
      page: safePage,
      pageSize: safePageSize,
      formats: selectedFormats,
    });

    if (selectedFormats.length === 0) {
      logEvent('search', requestId, 'Discover search results', { resultCount: 0, reason: 'no formats selected' });
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

    const discoverPage = await collectDiscoverPage(query, appName, selectedFormats, safePage, safePageSize);

    const groups = await Promise.all(
      discoverPage.groups.map(async (group) => ({
        ...group,
        discogsMasterUrl: await fetchReleaseGroupDiscogsMasterUrl(group.releaseGroupId, appName),
      })),
    );

    logEvent('search', requestId, 'Discover search results', {
      resultCount: groups.length,
      total: discoverPage.total,
      isTotalExact: discoverPage.isTotalExact,
      hasMore: discoverPage.hasMore,
      top: groups.slice(0, 3).map((g) => `${g.artist} - ${g.title}`),
      ms: Date.now() - startedAt,
    });

    res.json({
      query,
      page: safePage,
      pageSize: safePageSize,
      total: discoverPage.total,
      hasMore: discoverPage.hasMore,
      isTotalExact: discoverPage.isTotalExact,
      groups,
    });
  } catch (err) {
    logWarn('search', requestId, 'Discover search failed', { query, error: String(err) });
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

/**
 * Fetches release-groups matching `query` at MusicBrainz's own offset, then
 * enriches only the raw candidates needed (bounded batches of `pageSize`,
 * up to MAX_RAW_BATCHES_PER_PAGE rounds) to determine each one's available
 * formats — reusing the existing `fetchReleasesByGroupId` ("expand
 * releases") lookup rather than scanning individual releases. Candidates
 * with no release matching `selectedFormats` are dropped; if that drops
 * survivors below `pageSize`, the next raw batch is fetched to top up the
 * page, capped at MAX_RAW_BATCHES_PER_PAGE rounds total.
 */
async function fetchFilteredReleaseGroupPage(
  query: string,
  appName: string,
  selectedFormats: SearchFormat[],
  offset: number,
  pageSize: number,
): Promise<{ groups: FilteredReleaseGroup[]; rawCount: number; exhausted: boolean; hitRetryCap: boolean }> {
  const survivors: FilteredReleaseGroup[] = [];
  let currentOffset = offset;
  let rawCount = 0;
  let exhausted = false;
  let rounds = 0;

  while (survivors.length < pageSize && rounds < MAX_RAW_BATCHES_PER_PAGE) {
    rounds += 1;
    const response = await fetchReleaseGroupsByQuery(query, appName, pageSize, currentOffset);
    rawCount = response.count ?? rawCount;
    const rawBatch = response['release-groups'] ?? [];

    if (rawBatch.length === 0) {
      exhausted = true;
      break;
    }

    const candidates = rawBatch.map(mapReleaseGroupCandidate);
    const enriched = await Promise.all(
      candidates.map((candidate) => enrichCandidateWithFormats(candidate, appName, selectedFormats)),
    );

    for (const group of enriched) {
      if (group) survivors.push(group);
    }

    currentOffset += rawBatch.length;
    if (currentOffset >= rawCount) {
      exhausted = true;
      break;
    }
  }

  return {
    groups: survivors.slice(0, pageSize),
    rawCount,
    exhausted,
    hitRetryCap: rounds >= MAX_RAW_BATCHES_PER_PAGE && survivors.length < pageSize,
  };
}

/**
 * Resolves one page of the Discover search. Tries the exact-phrase query
 * first, using MusicBrainz's own exact `count` for true cursor pagination
 * (no scanning). Only once the requested offset is entirely past the exact
 * query's results does it switch — wholesale, at a disjoint offset — to the
 * broader fallback (AND-of-terms) query, so pages never straddle both
 * queries and can never show the same release-group twice.
 */
async function collectDiscoverPage(
  query: string,
  appName: string,
  selectedFormats: SearchFormat[],
  page: number,
  pageSize: number,
): Promise<{ groups: FilteredReleaseGroup[]; total: number; isTotalExact: boolean; hasMore: boolean }> {
  const normalizedQuery = normalizeSearchInput(query);
  const exactQuery = buildExactSearchQuery(normalizedQuery);
  const offset = (page - 1) * pageSize;

  const exactPage = await fetchFilteredReleaseGroupPage(exactQuery, appName, selectedFormats, offset, pageSize);
  const exactTotal = exactPage.rawCount;

  const canUseFallback = normalizedQuery.includes(' ');
  const fallbackQuery = canUseFallback ? buildFallbackSearchQuery(normalizedQuery) : exactQuery;
  const hasDistinctFallback = canUseFallback && fallbackQuery !== exactQuery;

  if (offset >= exactTotal && hasDistinctFallback) {
    const fallbackOffset = offset - exactTotal;
    const fallbackPage = await fetchFilteredReleaseGroupPage(
      fallbackQuery,
      appName,
      selectedFormats,
      fallbackOffset,
      pageSize,
    );
    const total = exactTotal + fallbackPage.rawCount;
    const isTotalExact = !fallbackPage.hitRetryCap;
    const hasMore = isTotalExact ? fallbackOffset + fallbackPage.groups.length < fallbackPage.rawCount : true;

    return { groups: fallbackPage.groups, total, isTotalExact, hasMore };
  }

  // If the exact query naturally ran out at this page boundary but a
  // fallback exists that we haven't queried yet, the total isn't the full
  // picture — mark it inexact rather than claiming a false certainty.
  const isTotalExact = !exactPage.hitRetryCap && !(exactPage.exhausted && hasDistinctFallback);
  const exactHasMore = offset + exactPage.groups.length < exactTotal;
  const hasMore = isTotalExact ? exactHasMore : true;

  return { groups: exactPage.groups, total: exactTotal, isTotalExact, hasMore };
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

async function fetchReleaseGroupsByQuery(
  query: string,
  appName: string,
  limit: number,
  offset: number,
): Promise<MusicBrainzReleaseGroupSearchResponse> {
  const url = new URL('https://musicbrainz.org/ws/2/release-group');
  url.searchParams.set('query', query);
  url.searchParams.set('fmt', 'json');
  url.searchParams.set('type', 'album');
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
    throw new Error(`MusicBrainz release-group search failed (${res.status})`);
  }

  return (await res.json()) as MusicBrainzReleaseGroupSearchResponse;
}

/** Maps a raw release-group search hit into the shape used by the bounded-retry filtering pipeline. */
function mapReleaseGroupCandidate(rg: MusicBrainzReleaseGroupSearchResult): CandidateReleaseGroup {
  return {
    releaseGroupId: rg.id,
    title: rg.title,
    artist: getArtistName(rg['artist-credit']),
    firstReleaseDate: rg['first-release-date'],
    releaseGroupUrl: `https://musicbrainz.org/release-group/${rg.id}`,
  };
}

/**
 * Fetches a candidate release-group's full release list (reusing the same
 * lookup the "expand releases" endpoint uses) to determine which formats it
 * has available. Returns `undefined` if none of its releases match
 * `selectedFormats` — the caller drops these candidates from the page.
 */
async function enrichCandidateWithFormats(
  candidate: CandidateReleaseGroup,
  appName: string,
  selectedFormats: SearchFormat[],
): Promise<FilteredReleaseGroup | undefined> {
  const releases = await fetchReleasesByGroupId(candidate.releaseGroupId, appName);
  const mapped = releases.map((release) => mapRelease(release, candidate.releaseGroupId));
  const matching = mapped.filter((release) => matchesRequestedFormat(release.format, selectedFormats));

  if (matching.length === 0) {
    return undefined;
  }

  const availableFormats = Array.from(
    new Set(matching.map((release) => release.format).filter((format): format is string => Boolean(format))),
  );

  return {
    ...candidate,
    thumbnailUrl: `https://coverartarchive.org/release-group/${candidate.releaseGroupId}/front-250`,
    availableFormats,
    totalReleases: matching.length,
  };
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


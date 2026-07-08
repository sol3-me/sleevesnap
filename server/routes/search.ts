import { Router } from 'express';
import { logEvent, logWarn, newRequestId } from '../logger.js';

export const searchRouter = Router();

const DEFAULT_GROUP_PAGE_SIZE = 5;
const MAX_GROUP_PAGE_SIZE = 5;
const RELEASE_LIMIT_PER_GROUP = 100;
const FLAT_SEARCH_LIMIT = 15;
// MusicBrainz's public API is rate-limited and occasionally slow/unavailable;
// a single timeout or 503 shouldn't fail the whole search. Retry transient
// failures a couple of times with a short backoff before giving up.
const MAX_FETCH_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 300;

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
  // MusicBrainz's own Album/Single/EP/etc. classification for this group —
  // surfaced so the UI can tell apart same-titled groups that are genuinely
  // different real-world releases (e.g. a pre-release single vs. the album
  // it's from), which our `type=album` search param doesn't reliably filter
  // out on its own (confirmed empirically: MusicBrainz still returns Single/
  // EP-type groups for that query).
  primaryType?: string;
}

interface EnrichedReleaseGroup extends CandidateReleaseGroup {
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

// POST /api/search/groups  – grouped by release group for the Discover view.
// Returns every matching release-group unfiltered, enriched with its real
// (whatever they are) formats — MusicBrainz's format data is community-
// maintained and can be incomplete or stale relative to what's actually been
// pressed, so filtering here would cap our own reliability at MusicBrainz's.
// The Vinyl/CD/etc. checkboxes are a client-side display filter instead; see
// musicbrainz-data-model.md.
searchRouter.post('/groups', async (req, res) => {
  const requestId = newRequestId();
  const startedAt = Date.now();
  const { query, page, pageSize } = req.body as {
    query?: string;
    page?: number;
    pageSize?: number;
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

    logEvent('search', requestId, 'Discover search request', {
      query,
      page: safePage,
      pageSize: safePageSize,
    });

    const discoverPage = await collectDiscoverPage(query, appName, safePage, safePageSize);

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

    // A release with no discernible format is represented as the literal
    // string 'Unknown' (mirroring MusicBrainz's own "(unknown)" format
    // value) rather than silently dropped, so the client's format filter can
    // still surface it instead of it just vanishing from the set.
    const availableFormats = Array.from(new Set(mapped.map((release) => release.format ?? 'Unknown')));

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

/**
 * Fetches one raw batch of release-groups matching `query` at MusicBrainz's
 * own offset, and enriches every candidate with its real format info via
 * `fetchReleasesByGroupId` (the same "expand releases" lookup) — nothing is
 * ever dropped, so a single batch always yields the page directly.
 */
async function fetchReleaseGroupPage(
  query: string,
  appName: string,
  offset: number,
  pageSize: number,
): Promise<{ groups: EnrichedReleaseGroup[]; rawCount: number }> {
  const response = await fetchReleaseGroupsByQuery(query, appName, pageSize, offset);
  const rawCount = response.count ?? 0;
  const candidates = (response['release-groups'] ?? []).map(mapReleaseGroupCandidate);
  const groups = await Promise.all(candidates.map((candidate) => enrichCandidate(candidate, appName)));

  return { groups, rawCount };
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
  page: number,
  pageSize: number,
): Promise<{ groups: EnrichedReleaseGroup[]; total: number; isTotalExact: boolean; hasMore: boolean }> {
  const normalizedQuery = normalizeSearchInput(query);
  const exactQuery = buildExactSearchQuery(normalizedQuery);
  const offset = (page - 1) * pageSize;

  const exactPage = await fetchReleaseGroupPage(exactQuery, appName, offset, pageSize);
  const exactTotal = exactPage.rawCount;

  const canUseFallback = normalizedQuery.includes(' ');
  const fallbackQuery = canUseFallback ? buildFallbackSearchQuery(normalizedQuery) : exactQuery;
  const hasDistinctFallback = canUseFallback && fallbackQuery !== exactQuery;

  if (offset >= exactTotal && hasDistinctFallback) {
    const fallbackOffset = offset - exactTotal;
    const fallbackPage = await fetchReleaseGroupPage(fallbackQuery, appName, fallbackOffset, pageSize);
    const total = exactTotal + fallbackPage.rawCount;
    const hasMore = fallbackOffset + fallbackPage.groups.length < fallbackPage.rawCount;

    return { groups: fallbackPage.groups, total, isTotalExact: true, hasMore };
  }

  const hasMore = offset + exactPage.groups.length < exactTotal;
  return { groups: exactPage.groups, total: exactTotal, isTotalExact: true, hasMore };
}

/** True for failures worth retrying: request timeouts and transient server-side errors (not 4xx client errors). */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function isRetryableFetchError(err: unknown): boolean {
  // AbortSignal.timeout() rejects with a DOMException named 'TimeoutError';
  // plain network failures surface as TypeError. Both are transient.
  if (err instanceof DOMException) return err.name === 'TimeoutError' || err.name === 'AbortError';
  return err instanceof TypeError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches a MusicBrainz URL, retrying up to MAX_FETCH_ATTEMPTS times (with a
 * short linear backoff) on timeouts and transient 429/5xx responses. Client
 * errors (4xx other than 429) and non-transient failures are not retried.
 */
async function fetchMusicBrainz(url: string, appName: string): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': `${appName}/1.0 (https://github.com/sol3uk/sleevesnap)`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok || !isRetryableStatus(res.status) || attempt === MAX_FETCH_ATTEMPTS) {
        return res;
      }

      console.warn(`[search] MusicBrainz request retrying after status ${res.status} (attempt ${attempt}): ${url}`);
    } catch (err) {
      if (!isRetryableFetchError(err) || attempt === MAX_FETCH_ATTEMPTS) {
        throw err;
      }

      lastError = err;
      console.warn(`[search] MusicBrainz request retrying after error (attempt ${attempt}): ${url} — ${String(err)}`);
    }

    await sleep(RETRY_BASE_DELAY_MS * attempt);
  }

  // Unreachable — the loop above always returns or throws on its final
  // attempt — but keeps TypeScript satisfied about the return type.
  throw lastError ?? new Error(`MusicBrainz request failed after ${MAX_FETCH_ATTEMPTS} attempts: ${url}`);
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

  const res = await fetchMusicBrainz(url.toString(), appName);

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

  const res = await fetchMusicBrainz(url.toString(), appName);

  if (!res.ok) {
    throw new Error(`MusicBrainz release-group search failed (${res.status})`);
  }

  return (await res.json()) as MusicBrainzReleaseGroupSearchResponse;
}

/** Maps a raw release-group search hit into the shape enriched by `enrichCandidate`. */
function mapReleaseGroupCandidate(rg: MusicBrainzReleaseGroupSearchResult): CandidateReleaseGroup {
  return {
    releaseGroupId: rg.id,
    title: rg.title,
    artist: getArtistName(rg['artist-credit']),
    firstReleaseDate: rg['first-release-date'],
    releaseGroupUrl: `https://musicbrainz.org/release-group/${rg.id}`,
    primaryType: rg['primary-type'],
  };
}

/**
 * Fetches a candidate release-group's full release list (reusing the same
 * lookup the "expand releases" endpoint uses) and enriches it with its real
 * format info — never drops the candidate, regardless of what formats it
 * does or doesn't have. A release with no discernible format contributes the
 * literal string 'Unknown' rather than being silently omitted, mirroring how
 * MusicBrainz's own site represents this. See musicbrainz-data-model.md for
 * why filtering by format happens client-side, not here.
 */
async function enrichCandidate(
  candidate: CandidateReleaseGroup,
  appName: string,
): Promise<EnrichedReleaseGroup> {
  const releases = await fetchReleasesByGroupId(candidate.releaseGroupId, appName);
  const mapped = releases.map((release) => mapRelease(release, candidate.releaseGroupId));
  const availableFormats = Array.from(new Set(mapped.map((release) => release.format ?? 'Unknown')));

  return {
    ...candidate,
    thumbnailUrl: `https://coverartarchive.org/release-group/${candidate.releaseGroupId}/front-250`,
    availableFormats,
    totalReleases: mapped.length,
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

  const res = await fetchMusicBrainz(url.toString(), appName);

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
    const res = await fetchMusicBrainz(url.toString(), appName);

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


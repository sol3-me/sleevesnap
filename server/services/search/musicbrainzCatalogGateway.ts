const DEFAULT_GROUP_PAGE_SIZE = 5;
const MAX_GROUP_PAGE_SIZE = 5;
const RELEASE_LIMIT_PER_GROUP = 100;
const FLAT_SEARCH_LIMIT = 15;
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
  primaryType?: string;
}

interface EnrichedReleaseGroup extends CandidateReleaseGroup {
  thumbnailUrl?: string;
  availableFormats: string[];
  totalReleases: number;
  discogsMasterUrl?: string;
}

export interface SearchReleaseResult {
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

export interface SearchIntent {
  artist?: string;
  title?: string;
  year?: string;
  label?: string;
  format?: string;
  country?: string;
}

export type SearchMode = 'simple' | 'indexed';

export interface SearchGroupsRequest {
  query?: string;
  intent?: SearchIntent;
  mode?: SearchMode;
  page?: number;
  pageSize?: number;
}

export interface SearchGroupsResponse {
  query: string;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  isTotalExact: boolean;
  groups: EnrichedReleaseGroup[];
}

interface SearchGroupReleases {
  releaseGroupId: string;
  availableFormats: string[];
  releases: SearchReleaseResult[];
}

export interface CatalogSearchGateway {
  searchReleasesByText(query: string, limit?: number): Promise<SearchReleaseResult[]>;
  searchGroups(input: SearchGroupsRequest): Promise<SearchGroupsResponse>;
  getReleaseGroupReleases(releaseGroupId: string): Promise<SearchGroupReleases & { discogsMasterUrl?: string }>;
}

export function createMusicBrainzCatalogGateway(appName: string): CatalogSearchGateway {
  return {
    async searchReleasesByText(query, limit = FLAT_SEARCH_LIMIT) {
      const releases = await fetchReleasesByText(query, appName, limit);
      return releases
        .map((release) => mapRelease(release))
        .filter((release) => isVinylFormat(release.format));
    },

    async searchGroups(input) {
      const safePage = Math.max(1, Number(input.page ?? 1));
      const safePageSize = Math.max(
        1,
        Math.min(MAX_GROUP_PAGE_SIZE, Number(input.pageSize ?? DEFAULT_GROUP_PAGE_SIZE)),
      );

      const mode = input.mode ?? 'simple';
      const querySource =
        mode === 'indexed' && input.intent
          ? buildIndexedReleaseGroupQuery(input.intent)
          : normalizeSearchInput(input.query ?? '');

      if (!querySource) {
        throw new Error('query is required');
      }

      const discoverPage =
        mode === 'indexed'
          ? await collectIndexedDiscoverPage(querySource, appName, safePage, safePageSize)
          : await collectDiscoverPage(querySource, appName, safePage, safePageSize);

      const groups = await Promise.all(
        discoverPage.groups.map(async (group) => ({
          ...group,
          discogsMasterUrl: await fetchReleaseGroupDiscogsMasterUrl(group.releaseGroupId, appName),
        })),
      );

      return {
        query: querySource,
        page: safePage,
        pageSize: safePageSize,
        total: discoverPage.total,
        hasMore: discoverPage.hasMore,
        isTotalExact: discoverPage.isTotalExact,
        groups,
      };
    },

    async getReleaseGroupReleases(releaseGroupId) {
      const [releases, discogsMasterUrl] = await Promise.all([
        fetchReleasesByGroupId(releaseGroupId, appName),
        fetchReleaseGroupDiscogsMasterUrl(releaseGroupId, appName),
      ]);
      const mapped = releases.map((release) => mapRelease(release, releaseGroupId));
      const availableFormats = Array.from(new Set(mapped.map((release) => release.format ?? 'Unknown')));

      return {
        releaseGroupId,
        availableFormats,
        discogsMasterUrl,
        releases: mapped,
      };
    },
  };
}

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

async function collectIndexedDiscoverPage(
  indexedQuery: string,
  appName: string,
  page: number,
  pageSize: number,
): Promise<{ groups: EnrichedReleaseGroup[]; total: number; isTotalExact: boolean; hasMore: boolean }> {
  const offset = (page - 1) * pageSize;
  const pageResult = await fetchReleaseGroupPage(indexedQuery, appName, offset, pageSize);
  const hasMore = offset + pageResult.groups.length < pageResult.rawCount;
  return {
    groups: pageResult.groups,
    total: pageResult.rawCount,
    isTotalExact: true,
    hasMore,
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function isRetryableFetchError(err: unknown): boolean {
  if (err instanceof DOMException) return err.name === 'TimeoutError' || err.name === 'AbortError';
  return err instanceof TypeError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function escapeLucenePhrase(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/"/g, '\\"').trim();
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

function buildIndexedReleaseGroupQuery(intent: SearchIntent): string {
  const clauses: string[] = [];

  if (intent.artist?.trim()) {
    const artist = escapeLucenePhrase(intent.artist);
    clauses.push(`(artist:"${artist}" OR artistname:"${artist}")`);
  }

  if (intent.title?.trim()) {
    const title = escapeLucenePhrase(intent.title);
    clauses.push(`(releasegroup:"${title}" OR release:"${title}")`);
  }

  if (intent.year?.trim()) {
    const year = intent.year.trim().slice(0, 4).replace(/[^0-9]/g, '');
    if (year.length === 4) {
      clauses.push(`firstreleasedate:${year}`);
    }
  }

  if (intent.label?.trim()) {
    clauses.push(`"${escapeLucenePhrase(intent.label)}"`);
  }

  if (intent.country?.trim()) {
    clauses.push(`country:${escapeLuceneTerm(intent.country.trim().toLowerCase())}`);
  }

  if (intent.format?.trim()) {
    clauses.push(`format:${escapeLuceneTerm(intent.format.trim())}`);
  }

  if (clauses.length === 0) {
    return '';
  }

  return clauses.join(' AND ');
}

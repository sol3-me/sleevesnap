const DEFAULT_GROUP_PAGE_SIZE = 10;
const MAX_GROUP_PAGE_SIZE = 25;
const RELEASE_LIMIT_PER_GROUP = 100;
const FLAT_SEARCH_LIMIT = 15;
const ENTITY_SEARCH_DEFAULT_PAGE_SIZE = 10;
const ENTITY_SEARCH_MAX_PAGE_SIZE = 25;
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
    'secondary-types'?: string[];
    'artist-credit'?: MusicBrainzArtistCredit[];
}

interface MusicBrainzReleaseGroupSearchResponse {
    count?: number;
    offset?: number;
    'release-groups'?: MusicBrainzReleaseGroupSearchResult[];
}

interface MusicBrainzReleaseGroupBrowseResponse {
    'release-group-count'?: number;
    'release-group-offset'?: number;
    'release-groups'?: MusicBrainzReleaseGroupSearchResult[];
}

interface MusicBrainzArtistSearchResult {
    id: string;
    name: string;
    disambiguation?: string;
    country?: string;
    area?: { name?: string };
    'begin-area'?: { name?: string };
    'sort-name'?: string;
    type?: string;
    score?: number | string;
    'life-span'?: {
        begin?: string;
        end?: string;
        ended?: boolean | string;
    };
}

interface MusicBrainzArtistSearchResponse {
    count?: number;
    offset?: number;
    artists?: MusicBrainzArtistSearchResult[];
}

interface MusicBrainzLabelSearchResult {
    id: string;
    name: string;
    disambiguation?: string;
    country?: string;
    area?: { name?: string };
    'sort-name'?: string;
    type?: string;
    'label-code'?: number | string;
    score?: number | string;
}

interface MusicBrainzLabelSearchResponse {
    count?: number;
    offset?: number;
    labels?: MusicBrainzLabelSearchResult[];
}

interface CandidateReleaseGroup {
    releaseGroupId: string;
    title: string;
    artist: string;
    firstReleaseDate?: string;
    secondaryTypes?: string[];
    releaseGroupUrl: string;
    primaryType?: string;
}

interface EnrichedReleaseGroup extends CandidateReleaseGroup {
    thumbnailUrl?: string;
    availableFormats: string[];
    totalReleases: number;
    discogsMasterUrl?: string;
}

export interface ArtistSearchEntity {
    id: string;
    name: string;
    disambiguation?: string;
    country?: string;
    area?: string;
    beginArea?: string;
    sortName?: string;
    type?: string;
    lifeSpanBegin?: string;
    lifeSpanEnd?: string;
    lifeSpanEnded?: boolean;
    score?: number;
}

export interface LabelSearchEntity {
    id: string;
    name: string;
    disambiguation?: string;
    country?: string;
    area?: string;
    sortName?: string;
    type?: string;
    labelCode?: string;
    score?: number;
}

export interface SearchEntitiesResponse<T> {
    query: string;
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
    entities: T[];
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
    artistId?: string;
    title?: string;
    year?: string;
    label?: string;
    labelId?: string;
    format?: string;
    country?: string;
    primaryTypes?: string[];
    excludePrimaryTypes?: string[];
    discographyBrowse?: boolean;
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
    searchArtists(query: string, page?: number, pageSize?: number): Promise<SearchEntitiesResponse<ArtistSearchEntity>>;
    searchLabels(query: string, page?: number, pageSize?: number): Promise<SearchEntitiesResponse<LabelSearchEntity>>;
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

            const useArtistDiscographyBrowse =
                input.mode === 'indexed' &&
                input.intent !== undefined &&
                shouldUseArtistDiscographyBrowse(input.intent);

            const mode = input.mode ?? 'simple';
            const querySource =
                useArtistDiscographyBrowse
                    ? buildArtistBrowseQueryDescription(input.intent!)
                    : mode === 'indexed' && input.intent
                    ? buildIndexedReleaseGroupQuery(input.intent)
                    : normalizeSearchInput(input.query ?? '');

            if (!querySource) {
                throw new Error('query is required');
            }

            const discoverPage =
                useArtistDiscographyBrowse
                    ? await collectArtistBrowseDiscoverPage(input.intent!, appName, safePage, safePageSize)
                    : mode === 'indexed'
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

        async searchArtists(query, page = 1, pageSize = ENTITY_SEARCH_DEFAULT_PAGE_SIZE) {
            const normalizedQuery = normalizeSearchInput(query);
            if (!normalizedQuery) {
                throw new Error('query is required');
            }

            const safePage = Math.max(1, Number(page ?? 1));
            const safePageSize = Math.max(
                1,
                Math.min(ENTITY_SEARCH_MAX_PAGE_SIZE, Number(pageSize ?? ENTITY_SEARCH_DEFAULT_PAGE_SIZE)),
            );
            const offset = (safePage - 1) * safePageSize;

            const response = await fetchArtistsByQuery(normalizedQuery, appName, safePageSize, offset);
            const entities = (response.artists ?? []).map(mapArtistEntity);
            const total = response.count ?? 0;

            return {
                query: normalizedQuery,
                page: safePage,
                pageSize: safePageSize,
                total,
                hasMore: offset + entities.length < total,
                entities,
            };
        },

        async searchLabels(query, page = 1, pageSize = ENTITY_SEARCH_DEFAULT_PAGE_SIZE) {
            const normalizedQuery = normalizeSearchInput(query);
            if (!normalizedQuery) {
                throw new Error('query is required');
            }

            const safePage = Math.max(1, Number(page ?? 1));
            const safePageSize = Math.max(
                1,
                Math.min(ENTITY_SEARCH_MAX_PAGE_SIZE, Number(pageSize ?? ENTITY_SEARCH_DEFAULT_PAGE_SIZE)),
            );
            const offset = (safePage - 1) * safePageSize;

            const response = await fetchLabelsByQuery(normalizedQuery, appName, safePageSize, offset);
            const entities = (response.labels ?? []).map(mapLabelEntity);
            const total = response.count ?? 0;

            return {
                query: normalizedQuery,
                page: safePage,
                pageSize: safePageSize,
                total,
                hasMore: offset + entities.length < total,
                entities,
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

async function collectArtistBrowseDiscoverPage(
    intent: SearchIntent,
    appName: string,
    page: number,
    pageSize: number,
): Promise<{ groups: EnrichedReleaseGroup[]; total: number; isTotalExact: boolean; hasMore: boolean }> {
    const artistId = intent.artistId?.trim();
    if (!artistId) {
        throw new Error('artistId is required for artist discography browse');
    }

    const primaryTypes = normalizePrimaryTypes(intent.primaryTypes);
    const typeFilter = primaryTypes.length > 0 ? primaryTypes.join('|') : undefined;
    const allCandidates = await fetchAllReleaseGroupCandidatesByArtistBrowse(artistId, typeFilter, appName);
    const sortedCandidates = allCandidates.sort((a, b) => compareDiscographyCandidates(a, b));

    const offset = (page - 1) * pageSize;
    const pageCandidates = sortedCandidates.slice(offset, offset + pageSize);
    const groups = await Promise.all(pageCandidates.map((candidate) => enrichCandidate(candidate, appName)));
    const hasMore = offset + groups.length < sortedCandidates.length;

    return {
        groups,
        total: sortedCandidates.length,
        isTotalExact: true,
        hasMore,
    };
}

async function fetchAllReleaseGroupCandidatesByArtistBrowse(
    artistId: string,
    typeFilter: string | undefined,
    appName: string,
): Promise<CandidateReleaseGroup[]> {
    const MAX_BROWSE_PAGE_SIZE = 100;
    const gathered: MusicBrainzReleaseGroupSearchResult[] = [];
    let offset = 0;
    let total = 0;

    do {
        const response = await fetchReleaseGroupsByArtistBrowse(
            artistId,
            appName,
            MAX_BROWSE_PAGE_SIZE,
            offset,
            typeFilter,
        );
        const groups = response['release-groups'] ?? [];
        total = response['release-group-count'] ?? groups.length;
        gathered.push(...groups);
        offset += groups.length;

        if (groups.length === 0) {
            break;
        }
    } while (offset < total);

    return gathered.map(mapReleaseGroupCandidate);
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

async function fetchReleaseGroupsByArtistBrowse(
    artistId: string,
    appName: string,
    limit: number,
    offset: number,
    typeFilter?: string,
): Promise<MusicBrainzReleaseGroupBrowseResponse> {
    const url = new URL('https://musicbrainz.org/ws/2/release-group');
    url.searchParams.set('artist', artistId);
    url.searchParams.set('fmt', 'json');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('inc', 'artist-credits');
    url.searchParams.set('release-group-status', 'website-default');

    if (typeFilter) {
        url.searchParams.set('type', typeFilter);
    }

    const res = await fetchMusicBrainz(url.toString(), appName);

    if (!res.ok) {
        throw new Error(`MusicBrainz release-group browse failed (${res.status})`);
    }

    return (await res.json()) as MusicBrainzReleaseGroupBrowseResponse;
}

async function fetchArtistsByQuery(
    query: string,
    appName: string,
    limit: number,
    offset: number,
): Promise<MusicBrainzArtistSearchResponse> {
    const url = new URL('https://musicbrainz.org/ws/2/artist');
    url.searchParams.set('query', query);
    url.searchParams.set('fmt', 'json');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    const res = await fetchMusicBrainz(url.toString(), appName);

    if (!res.ok) {
        throw new Error(`MusicBrainz artist search failed (${res.status})`);
    }

    return (await res.json()) as MusicBrainzArtistSearchResponse;
}

async function fetchLabelsByQuery(
    query: string,
    appName: string,
    limit: number,
    offset: number,
): Promise<MusicBrainzLabelSearchResponse> {
    const url = new URL('https://musicbrainz.org/ws/2/label');
    url.searchParams.set('query', query);
    url.searchParams.set('fmt', 'json');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    const res = await fetchMusicBrainz(url.toString(), appName);

    if (!res.ok) {
        throw new Error(`MusicBrainz label search failed (${res.status})`);
    }

    return (await res.json()) as MusicBrainzLabelSearchResponse;
}

function mapReleaseGroupCandidate(rg: MusicBrainzReleaseGroupSearchResult): CandidateReleaseGroup {
    return {
        releaseGroupId: rg.id,
        title: rg.title,
        artist: getArtistName(rg['artist-credit']),
        firstReleaseDate: rg['first-release-date'],
        secondaryTypes: rg['secondary-types'],
        releaseGroupUrl: `https://musicbrainz.org/release-group/${rg.id}`,
        primaryType: rg['primary-type'],
    };
}

function mapArtistEntity(artist: MusicBrainzArtistSearchResult): ArtistSearchEntity {
    return {
        id: artist.id,
        name: artist.name,
        disambiguation: artist.disambiguation,
        country: artist.country,
        area: artist.area?.name,
        beginArea: artist['begin-area']?.name,
        sortName: artist['sort-name'],
        type: artist.type,
        lifeSpanBegin: artist['life-span']?.begin,
        lifeSpanEnd: artist['life-span']?.end,
        lifeSpanEnded: toBoolean(artist['life-span']?.ended),
        score: toNumber(artist.score),
    };
}

function mapLabelEntity(label: MusicBrainzLabelSearchResult): LabelSearchEntity {
    return {
        id: label.id,
        name: label.name,
        disambiguation: label.disambiguation,
        country: label.country,
        area: label.area?.name,
        sortName: label['sort-name'],
        type: label.type,
        labelCode: label['label-code'] !== undefined ? String(label['label-code']) : undefined,
        score: toNumber(label.score),
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
    return input
        .replace(/\|\||&&/g, ' ')
        .replace(/[+\-!(){}\[\]^"~*?:\\/]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
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

function normalizePrimaryTypes(values: string[] | undefined): string[] {
    return (values ?? [])
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0);
}

function shouldUseArtistDiscographyBrowse(intent: SearchIntent): boolean {
    if (!intent.discographyBrowse) return false;
    if (!intent.artistId?.trim()) return false;
    if (intent.title?.trim()) return false;
    if (intent.year?.trim()) return false;
    if (intent.label?.trim()) return false;
    if (intent.labelId?.trim()) return false;
    if (intent.country?.trim()) return false;
    if (intent.format?.trim()) return false;

    const includeTypes = normalizePrimaryTypes(intent.primaryTypes);
    const excludeTypes = normalizePrimaryTypes(intent.excludePrimaryTypes);
    return includeTypes.length > 0 && excludeTypes.length === 0;
}

function buildArtistBrowseQueryDescription(intent: SearchIntent): string {
    const artistId = intent.artistId?.trim() ?? '';
    const includeTypes = normalizePrimaryTypes(intent.primaryTypes);
    const typePart = includeTypes.length > 0 ? includeTypes.join('|') : 'all';
    return `artist:${artistId} type:${typePart} release-group-status:website-default`;
}

function compareDiscographyCandidates(a: CandidateReleaseGroup, b: CandidateReleaseGroup): number {
    const primaryTypeOrder = (value: string | undefined): number => {
        const normalized = value?.trim().toLowerCase() ?? '';
        if (normalized === 'album') return 0;
        if (normalized === 'single') return 1;
        if (normalized === 'ep') return 2;
        return 3;
    };

    const secondaryWeight = (values: string[] | undefined): number => {
        if (!values || values.length === 0) return 0;
        const normalized = values.map((value) => value.trim().toLowerCase());
        if (normalized.some((value) => value === 'compilation')) return 2;
        if (normalized.some((value) => value === 'live')) return 3;
        return 1;
    };

    const parseYear = (value: string | undefined): number => {
        if (!value) return Number.MAX_SAFE_INTEGER;
        const parsed = Number(value.slice(0, 4));
        return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
    };

    const primaryDiff = primaryTypeOrder(a.primaryType) - primaryTypeOrder(b.primaryType);
    if (primaryDiff !== 0) return primaryDiff;

    const secondaryDiff = secondaryWeight(a.secondaryTypes) - secondaryWeight(b.secondaryTypes);
    if (secondaryDiff !== 0) return secondaryDiff;

    const yearDiff = parseYear(a.firstReleaseDate) - parseYear(b.firstReleaseDate);
    if (yearDiff !== 0) return yearDiff;

    return a.title.localeCompare(b.title, 'en', { sensitivity: 'base' });
}

function buildIndexedReleaseGroupQuery(intent: SearchIntent): string {
    const clauses: string[] = [];
    const normalizedArtistId = intent.artistId?.trim();
    const normalizedLabelId = intent.labelId?.trim();
    const normalizedLabel = intent.label?.trim();
    const includePrimaryTypes = normalizePrimaryTypes(intent.primaryTypes);
    const excludePrimaryTypes = normalizePrimaryTypes(intent.excludePrimaryTypes);

    if (normalizedArtistId) {
        clauses.push(`arid:${escapeLuceneTerm(normalizedArtistId)}`);
    } else if (intent.artist?.trim()) {
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

    if (normalizedLabelId) {
        clauses.push(`laid:${escapeLuceneTerm(normalizedLabelId)}`);
    }

    // Name-based label terms remain intentionally non-strict when combined
    // with other clauses. Real MusicBrainz probes showed strict label-name
    // AND conditions can collapse relevant artist/title/year matches.
    // Label-only searches still support a direct label name clause.
    if (normalizedLabel && clauses.length === 0) {
        return `label:"${escapeLucenePhrase(normalizedLabel)}"`;
    }

    if (intent.country?.trim()) {
        clauses.push(`country:${escapeLuceneTerm(intent.country.trim().toLowerCase())}`);
    }

    if (intent.format?.trim()) {
        clauses.push(`format:${escapeLuceneTerm(intent.format.trim())}`);
    }

    if (includePrimaryTypes.length === 1) {
        clauses.push(`primarytype:${escapeLuceneTerm(includePrimaryTypes[0] ?? '')}`);
    } else if (includePrimaryTypes.length > 1) {
        clauses.push(`(${includePrimaryTypes.map((value) => `primarytype:${escapeLuceneTerm(value)}`).join(' OR ')})`);
    }

    if (excludePrimaryTypes.length > 0) {
        for (const excludedType of excludePrimaryTypes) {
            clauses.push(`NOT primarytype:${escapeLuceneTerm(excludedType)}`);
        }
    }

    if (clauses.length === 0) {
        return '';
    }

    return clauses.join(' AND ');
}

function toNumber(value: number | string | undefined): number | undefined {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function toBoolean(value: boolean | string | undefined): boolean | undefined {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        if (value.toLowerCase() === 'true') return true;
        if (value.toLowerCase() === 'false') return false;
    }
    return undefined;
}

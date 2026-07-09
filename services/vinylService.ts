import {
  ArtistSearchEntity,
  LabelSearchEntity,
  ScanResponse,
  ScanUploadPayload,
  SearchEntityPage,
  SearchGroupReleases,
  SearchIntent,
  SearchMode,
  SearchResultPage,
  VinylRecord,
} from '../types';

export type DiscoverSearchType = 'title' | 'artist' | 'label';

export interface ReleaseGroupSearchRequest {
  query?: string;
  mode?: SearchMode;
  intent?: SearchIntent;
  page?: number;
  pageSize?: number;
}

export interface SearchEntityRequest {
  query: string;
  page?: number;
  pageSize?: number;
}

const CACHE_PREFIX = 'sleevesnap:search:v5:';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const memoryCache = new Map<string, { expiresAt: number; value: unknown }>();

function getCacheKey(key: string): string {
  return `${CACHE_PREFIX}${key}`;
}

function getCached<T>(key: string): T | undefined {
  const cacheKey = getCacheKey(key);
  const now = Date.now();

  const inMemory = memoryCache.get(cacheKey);
  if (inMemory) {
    if (inMemory.expiresAt > now) {
      return inMemory.value as T;
    }
    memoryCache.delete(cacheKey);
  }

  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { expiresAt: number; value: T };
    if (parsed.expiresAt <= now) {
      window.localStorage.removeItem(cacheKey);
      return undefined;
    }
    memoryCache.set(cacheKey, { expiresAt: parsed.expiresAt, value: parsed.value });
    return parsed.value;
  } catch {
    return undefined;
  }
}

function setCached<T>(key: string, value: T, ttl = CACHE_TTL_MS): void {
  const cacheKey = getCacheKey(key);
  const payload = {
    expiresAt: Date.now() + ttl,
    value,
  };

  memoryCache.set(cacheKey, payload);

  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(cacheKey, JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors.
  }
}

/**
 * Sends a base64-encoded JPEG to the server-side scan endpoint, which
 * checks the image against the user's collection using a local perceptual
 * hashing algorithm (dHash).
 *
 * Returns `{ matched: true, record }` when a collection item matches, or
 * `{ matched: false }` when no match is found and the user should be asked
 * to search manually.
 */
export const scanImage = async (base64Image: string): Promise<ScanResponse> => {
  const res = await fetch('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Image }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Failed to scan image.');
  }

  return res.json();
};

/**
 * Uploads a confirmed scan result to the server.  The server adds the record
 * to the collection and stores the perceptual hash for future matching.
 */
export const submitScan = async (payload: ScanUploadPayload): Promise<VinylRecord> => {
  const res = await fetch('/api/scans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Failed to save scan.');
  }

  const data = await res.json() as { record: VinylRecord };
  return data.record;
};

/**
 * Queries the server-side search endpoint, which uses MusicBrainz to find
 * vinyl records matching the given query string.
 */
export const searchVinylDatabase = async (
  query: string,
  includeOtherFormats = false,
): Promise<VinylRecord[]> => {
  const res = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, includeOtherFormats }),
  });

  if (!res.ok) return [];
  return res.json();
};

/**
 * Queries paginated release-group search results for Discover Vinyl. The
 * server returns every matching release-group unfiltered, enriched with its
 * real formats — Vinyl/CD/etc. filtering is applied client-side (see
 * musicbrainz-data-model.md), so it plays no part in this request or its
 * cache key.
 */
export const searchVinylReleaseGroups = async (
  queryOrRequest: string | ReleaseGroupSearchRequest,
  page = 1,
  pageSize = 10,
): Promise<SearchResultPage> => {
  const request: ReleaseGroupSearchRequest =
    typeof queryOrRequest === 'string'
      ? { query: queryOrRequest, page, pageSize }
      : {
        ...queryOrRequest,
        page: queryOrRequest.page ?? page,
        pageSize: queryOrRequest.pageSize ?? pageSize,
      };

  const requestIdentity = {
    query: request.query?.trim().toLowerCase() ?? '',
    mode: request.mode ?? 'simple',
    intent: {
      title: request.intent?.title?.trim().toLowerCase() ?? '',
      artist: request.intent?.artist?.trim().toLowerCase() ?? '',
      artistId: request.intent?.artistId?.trim().toLowerCase() ?? '',
      year: request.intent?.year?.trim() ?? '',
      label: request.intent?.label?.trim().toLowerCase() ?? '',
      labelId: request.intent?.labelId?.trim().toLowerCase() ?? '',
      format: request.intent?.format?.trim().toLowerCase() ?? '',
      country: request.intent?.country?.trim().toLowerCase() ?? '',
      primaryTypes: (request.intent?.primaryTypes ?? [])
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0),
      excludePrimaryTypes: (request.intent?.excludePrimaryTypes ?? [])
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0),
    },
    page: request.page,
    pageSize: request.pageSize,
  };

  const cacheKey = `groups:${JSON.stringify(requestIdentity)}`;
  const cached = getCached<SearchResultPage>(cacheKey);
  if (cached) {
    return cached;
  }

  const res = await fetch('/api/search/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    // Surface failures distinctly rather than faking a valid "no results"
    // page — a caller silently treating a 502/timeout as "0 results found"
    // is indistinguishable from a genuine empty search, which is exactly
    // what made an earlier transient backend outage look like a pagination
    // bug instead of a network error.
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Search failed (${res.status})`);
  }

  const result = (await res.json()) as SearchResultPage;

  // Only cache confirmed-useful (non-empty) results. Caching a miss for 6
  // hours means retyping the exact same partial query later — very common
  // while iteratively narrowing a search — replays a stale "no results"
  // instead of giving the (fast, cheap) MusicBrainz query another chance.
  // Real example: "songs for the de" legitimately returns 0 matches, but
  // that shouldn't be remembered as gospel for the rest of the session.
  if (result.groups.length > 0) {
    setCached(cacheKey, result);
  }

  return result;
};

/**
 * Gets all releases for a release group (cached), used when expanding groups.
 */
export const getReleaseGroupReleases = async (
  releaseGroupId: string,
): Promise<SearchGroupReleases> => {
  const cacheKey = `group:${releaseGroupId}:releases`;
  const cached = getCached<SearchGroupReleases>(cacheKey);
  if (cached) {
    return cached;
  }

  const res = await fetch(`/api/search/groups/${encodeURIComponent(releaseGroupId)}/releases`);
  if (!res.ok) {
    return {
      releaseGroupId,
      availableFormats: [],
      releases: [],
    };
  }

  const result = (await res.json()) as SearchGroupReleases;
  setCached(cacheKey, result);
  return result;
};

export const searchArtistEntities = async (
  request: SearchEntityRequest,
): Promise<SearchEntityPage<ArtistSearchEntity>> => {
  const payload: SearchEntityRequest = {
    query: request.query,
    page: request.page ?? 1,
    pageSize: request.pageSize ?? 10,
  };

  const cacheKey = `artists:${JSON.stringify({
    query: payload.query.trim().toLowerCase(),
    page: payload.page,
    pageSize: payload.pageSize,
  })}`;
  const cached = getCached<SearchEntityPage<ArtistSearchEntity>>(cacheKey);
  if (cached) {
    return cached;
  }

  const res = await fetch('/api/search/artists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Artist search failed (${res.status})`);
  }

  const result = (await res.json()) as SearchEntityPage<ArtistSearchEntity>;
  if (result.entities.length > 0) {
    setCached(cacheKey, result);
  }

  return result;
};

export const searchLabelEntities = async (
  request: SearchEntityRequest,
): Promise<SearchEntityPage<LabelSearchEntity>> => {
  const payload: SearchEntityRequest = {
    query: request.query,
    page: request.page ?? 1,
    pageSize: request.pageSize ?? 10,
  };

  const cacheKey = `labels:${JSON.stringify({
    query: payload.query.trim().toLowerCase(),
    page: payload.page,
    pageSize: payload.pageSize,
  })}`;
  const cached = getCached<SearchEntityPage<LabelSearchEntity>>(cacheKey);
  if (cached) {
    return cached;
  }

  const res = await fetch('/api/search/labels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Label search failed (${res.status})`);
  }

  const result = (await res.json()) as SearchEntityPage<LabelSearchEntity>;
  if (result.entities.length > 0) {
    setCached(cacheKey, result);
  }

  return result;
};

// ---------------------------------------------------------------------------
// Legacy export kept for backwards compatibility
// ---------------------------------------------------------------------------

/** @deprecated Use scanImage() instead */
export const identifyVinylsFromImage = async (base64Image: string) => {
  const result = await scanImage(base64Image);
  if (result.matched) {
    return [{ artist: result.record.artist, title: result.record.title, year: result.record.year, genre: result.record.genre, confidence: 1.0 }];
  }
  return [];
};


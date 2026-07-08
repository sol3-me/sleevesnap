import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FilterDropdown } from '../components/FilterDropdown';
import { useAddToCollectionMutation, useCollectionQuery } from '../hooks/useCollection';
import {
  bucketForFormat,
  FilterState,
  formatBucketsForGroup,
  groupReleasesByFormatBucket,
  loadStoredFilterState,
  sortFormatBuckets,
  sortTypeBuckets,
  typeBucketForGroup,
} from '../lib/filters';
import { logEvent, logWarn } from '../services/telemetry';
import { getReleaseGroupReleases, searchVinylReleaseGroups } from '../services/vinylService';
import { SearchGroupReleases, SearchRelease, SearchResultGroup, SearchResultPage, VinylRecord } from '../types';

const routeApi = getRouteApi('/discover');

const SEARCH_PAGE_SIZE = 5;
const SEARCH_FORMAT_FILTERS_KEY = 'sleevesnap:search-filters:v2';
const SEARCH_TYPE_FILTERS_KEY = 'sleevesnap:search-type-filters:v1';

const defaultSearchPage: SearchResultPage = {
  query: '',
  page: 1,
  pageSize: SEARCH_PAGE_SIZE,
  total: 0,
  hasMore: false,
  isTotalExact: true,
  groups: [],
};

export function DiscoverView() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const { data: collection } = useCollectionQuery();
  const addMutation = useAddToCollectionMutation();

  // The committed query/page live in the URL (search.q / search.page) so
  // they're shareable and survive back/forward — inputValue is just the
  // free-typing draft in the search box until Enter/Search commits it.
  const [inputValue, setInputValue] = useState(search.q ?? '');
  const [searchPage, setSearchPage] = useState<SearchResultPage>(defaultSearchPage);
  const [groupReleases, setGroupReleases] = useState<Record<string, SearchGroupReleases>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [loadingGroupIds, setLoadingGroupIds] = useState<Record<string, true>>({});
  const [formatFilters, setFormatFilters] = useState<FilterState>(() => loadStoredFilterState(SEARCH_FORMAT_FILTERS_KEY));
  const [typeFilters, setTypeFilters] = useState<FilterState>(() => loadStoredFilterState(SEARCH_TYPE_FILTERS_KEY));
  const [discoveredFormatBuckets, setDiscoveredFormatBuckets] = useState<string[]>([]);
  const [discoveredTypeBuckets, setDiscoveredTypeBuckets] = useState<string[]>([]);
  const [failedCovers, setFailedCovers] = useState<Record<string, true>>({});
  const [isSearching, setIsSearching] = useState(false);
  const releasesRef = useRef<Record<string, SearchGroupReleases>>({});
  const loadingRef = useRef<Set<string>>(new Set());
  const previousQueryRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    setInputValue(search.q ?? '');
  }, [search.q]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SEARCH_FORMAT_FILTERS_KEY, JSON.stringify(formatFilters));
    } catch {
      // Ignore storage write failures.
    }
  }, [formatFilters]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SEARCH_TYPE_FILTERS_KEY, JSON.stringify(typeFilters));
    } catch {
      // Ignore storage write failures.
    }
  }, [typeFilters]);

  const runSearch = useCallback(async (page: number, query: string, isNewQuery: boolean) => {
    setIsSearching(true);
    const startedAt = performance.now();

    try {
      const result = await searchVinylReleaseGroups(query, page, SEARCH_PAGE_SIZE);
      logEvent('discover', 'Search results', {
        query,
        page,
        total: result.total,
        returned: result.groups.length,
        top: result.groups.slice(0, 3).map((g) => `${g.artist} - ${g.title}`),
        ms: Math.round(performance.now() - startedAt),
      });
      setSearchPage(result);
      // Accumulate format buckets across pages of the same query (so
      // checkboxes don't disappear/reappear while paging), but start fresh
      // for a brand new query.
      setDiscoveredFormatBuckets((prev) => {
        const base = isNewQuery ? [] : prev;
        const next = new Set(base);
        for (const group of result.groups) {
          for (const bucket of formatBucketsForGroup(group)) next.add(bucket);
        }
        return Array.from(next);
      });
      // Same accumulate-across-pages, reset-on-new-query pattern for type.
      setDiscoveredTypeBuckets((prev) => {
        const base = isNewQuery ? [] : prev;
        const next = new Set(base);
        for (const group of result.groups) next.add(typeBucketForGroup(group));
        return Array.from(next);
      });
      setGroupReleases({});
      releasesRef.current = {};
      loadingRef.current.clear();
      setLoadingGroupIds({});
      setExpandedGroups({});
      setFailedCovers({});
    } catch (err) {
      // Leave the previously-shown results in place rather than replacing
      // them with an empty page — a failed "next page" fetch shouldn't wipe
      // out the page the user is already looking at.
      logWarn('discover', 'Search failed', { query, page, error: err instanceof Error ? err.message : String(err) });
      toast.error('Search failed. Please try again.');
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    const q = search.q?.trim();
    if (!q) return;
    const isNewQuery = previousQueryRef.current !== q;
    previousQueryRef.current = q;
    void runSearch(search.page ?? 1, q, isNewQuery);
  }, [search.q, search.page, runSearch]);

  const submitSearch = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    void navigate({ search: { q: trimmed, page: 1 } });
  };

  const goToPage = (page: number) => {
    void navigate({ search: (prev) => ({ ...prev, page }) });
  };

  const loadReleasesForGroup = useCallback(
    async (releaseGroupId: string, silent = false) => {
      if (releasesRef.current[releaseGroupId]) {
        return releasesRef.current[releaseGroupId];
      }
      if (loadingRef.current.has(releaseGroupId)) {
        return undefined;
      }

      loadingRef.current.add(releaseGroupId);
      if (!silent) {
        setLoadingGroupIds((prev) => ({ ...prev, [releaseGroupId]: true }));
      }

      try {
        const result = await getReleaseGroupReleases(releaseGroupId);
        setGroupReleases((prev) => {
          if (prev[releaseGroupId]) return prev;
          const next = { ...prev, [releaseGroupId]: result };
          releasesRef.current = next;
          return next;
        });
        return result;
      } finally {
        loadingRef.current.delete(releaseGroupId);
        if (!silent) {
          setLoadingGroupIds((prev) => {
            const next = { ...prev };
            delete next[releaseGroupId];
            return next;
          });
        }
      }
    },
    [],
  );

  const isFormatBucketChecked = useCallback(
    (bucket: string) => formatFilters[bucket] ?? true,
    [formatFilters],
  );

  const isTypeBucketChecked = useCallback(
    (bucket: string) => typeFilters[bucket] ?? true,
    [typeFilters],
  );

  const groupMatchesFilters = useCallback(
    (group: SearchResultGroup) =>
      formatBucketsForGroup(group).some(isFormatBucketChecked) &&
      isTypeBucketChecked(typeBucketForGroup(group)),
    [isFormatBucketChecked, isTypeBucketChecked],
  );

  const releaseMatchesFilters = useCallback(
    (format?: string) => isFormatBucketChecked(bucketForFormat(format ?? 'Unknown')),
    [isFormatBucketChecked],
  );

  const sortedFormatBuckets = useMemo(() => {
    return sortFormatBuckets(discoveredFormatBuckets);
  }, [discoveredFormatBuckets]);

  const sortedTypeBuckets = useMemo(() => {
    return sortTypeBuckets(discoveredTypeBuckets);
  }, [discoveredTypeBuckets]);

  const filteredGroups = useMemo(
    () => searchPage.groups.filter(groupMatchesFilters),
    [searchPage.groups, groupMatchesFilters],
  );

  const totalPages = Math.max(1, Math.ceil(searchPage.total / searchPage.pageSize));

  // Mirrors the server's own dedup key (musicBrainzId when present, see
  // server/routes/collection.ts) so the button reflects collection state
  // before the user even clicks it. Two different pressings of the same
  // album (e.g. an original US pressing vs. a later reissue) are distinct
  // collectible items, not duplicates — only an exact pressing match (or,
  // absent a musicBrainzId, an exact artist+title match) counts as owned.
  const collectionMbids = useMemo(
    () => new Set(collection.map((r) => r.musicBrainzId).filter((id): id is string => Boolean(id))),
    [collection],
  );

  const collectionArtistTitleKeys = useMemo(
    () =>
      new Set(
        collection
          .filter((r) => !r.musicBrainzId)
          .map((r) => `${r.artist.toLowerCase()}::${r.title.toLowerCase()}`),
      ),
    [collection],
  );

  const isReleaseOwned = useCallback(
    (release: { musicBrainzId?: string; artist: string; title: string }) =>
      release.musicBrainzId
        ? collectionMbids.has(release.musicBrainzId)
        : collectionArtistTitleKeys.has(`${release.artist.toLowerCase()}::${release.title.toLowerCase()}`),
    [collectionMbids, collectionArtistTitleKeys],
  );

  // A release-group is "owned" if any pressing of it is already saved —
  // shown as a group-level badge, separate from the per-release button
  // above which reflects one specific pressing.
  const collectionReleaseGroupIds = useMemo(
    () => new Set(collection.map((r) => r.releaseGroupId).filter((id): id is string => Boolean(id))),
    [collection],
  );

  const isGroupOwned = useCallback(
    (releaseGroupId: string) => collectionReleaseGroupIds.has(releaseGroupId),
    [collectionReleaseGroupIds],
  );

  const getFilteredReleases = (group: SearchResultGroup) => {
    const detail = groupReleases[group.releaseGroupId];
    if (!detail) return [];
    return detail.releases.filter((release) => releaseMatchesFilters(release.format));
  };

  const toggleGroupExpanded = async (group: SearchResultGroup) => {
    const isOpen = Boolean(expandedGroups[group.releaseGroupId]);
    const nextOpen = !isOpen;

    setExpandedGroups((prev) => ({
      ...prev,
      [group.releaseGroupId]: nextOpen,
    }));

    if (nextOpen) {
      await loadReleasesForGroup(group.releaseGroupId);
    }
  };

  const formatCountry = (countryCode?: string) => {
    if (!countryCode) return undefined;
    const specialRegions: Record<string, string> = {
      XE: 'Europe',
      XW: 'Worldwide',
      XG: 'East Germany',
    };

    if (specialRegions[countryCode]) {
      return `${specialRegions[countryCode]} (${countryCode})`;
    }

    try {
      const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode);
      if (name && name !== countryCode) {
        return `${name} (${countryCode})`;
      }
    } catch {
      // Ignore and fall through to the raw code.
    }

    return countryCode;
  };

  const getCoverFailureKey = (recordId: string, coverUrl: string) =>
    `${recordId}::${coverUrl}`;

  const handleCoverError = (recordId: string, coverUrl: string) => {
    setFailedCovers((prev) => ({
      ...prev,
      [getCoverFailureKey(recordId, coverUrl)]: true,
    }));
  };

  const renderCoverThumb = (
    id: string,
    title: string,
    urlOrUrls?: string | Array<string | undefined>,
    placeholderText = 'No cover',
  ) => {
    const candidateUrls = (Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls])
      .map((url) => url?.trim())
      .filter((url): url is string => Boolean(url))
      .filter((url) => !failedCovers[getCoverFailureKey(id, url)]);

    const activeUrl = candidateUrls[0];

    if (activeUrl) {
      return (
        <img
          src={activeUrl}
          alt={title}
          onError={() => handleCoverError(id, activeUrl)}
          className="w-full h-full object-cover"
        />
      );
    }

    return (
      <div className="w-full h-full bg-vinyl-700 text-gray-300 flex flex-col items-center justify-center text-[10px] leading-tight">
        <span className="text-lg" aria-hidden="true">♪</span>
        <span>{placeholderText}</span>
      </div>
    );
  };

  const handleAddToCollection = async (record: VinylRecord) => {
    const success = await addMutation.mutateAsync(record);
    if (success) {
      logEvent('collection', 'Added to collection', { artist: record.artist, title: record.title });
      toast.success(`Added "${record.title}" to collection`);
    } else {
      logEvent('collection', 'Add skipped — already in collection', { artist: record.artist, title: record.title });
      toast(`"${record.title}" is already in your collection`);
    }
  };

  return (
    <div className="p-4 md:p-8 pb-24">
      <h2 className="text-3xl font-bold text-white mb-6">Discover Vinyl</h2>
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitSearch()}
            placeholder="Search artist or album..."
            className="flex-1 bg-vinyl-800 text-white border border-vinyl-700 rounded-lg p-3 focus:ring-1 focus:ring-vinyl-accent focus:outline-none"
          />
          <button
            onClick={submitSearch}
            disabled={isSearching}
            className="bg-vinyl-700 hover:bg-vinyl-600 text-white px-6 rounded-lg transition-colors font-medium disabled:opacity-50"
          >
            {isSearching ? '...' : 'Search'}
          </button>
        </div>
        {(sortedFormatBuckets.length > 0 || sortedTypeBuckets.length > 0) && (
          <div className="flex flex-wrap items-center gap-3">
            {sortedFormatBuckets.length > 0 && (
              <FilterDropdown
                label="Format"
                options={sortedFormatBuckets}
                isSelected={isFormatBucketChecked}
                onToggle={(bucket, checked) =>
                  setFormatFilters((prev) => ({ ...prev, [bucket]: checked }))
                }
              />
            )}
            {sortedTypeBuckets.length > 0 && (
              <FilterDropdown
                label="Type"
                options={sortedTypeBuckets}
                isSelected={isTypeBucketChecked}
                onToggle={(bucket, checked) =>
                  setTypeFilters((prev) => ({ ...prev, [bucket]: checked }))
                }
                accentClassName="border-l-2 border-l-blue-500/60"
              />
            )}
          </div>
        )}
      </div>

      {isSearching && (
        <div className="mb-4 bg-vinyl-800 border border-vinyl-700 rounded-lg p-3">
          <div className="flex items-center gap-3 text-sm text-gray-200">
            <div className="w-4 h-4 border-2 border-vinyl-accent border-t-transparent rounded-full animate-spin" />
            Searching MusicBrainz release groups...
          </div>
          <div className="mt-3 h-1.5 bg-vinyl-700 rounded overflow-hidden">
            <div className="search-progress-bar h-full bg-vinyl-accent" />
          </div>
        </div>
      )}

      {searchPage.total > 0 && (
        <div className="mb-4 text-sm text-gray-400 flex flex-wrap gap-4">
          <span>{`${searchPage.total.toLocaleString()} matching release groups`}</span>
          <span>{`Page ${searchPage.page} of ${totalPages}`}</span>
          <span>{`${filteredGroups.length} of ${searchPage.groups.length} shown on this page`}</span>
        </div>
      )}

      <div className="space-y-4">
        {filteredGroups.map((group) => {
          const details = groupReleases[group.releaseGroupId];
          const filteredReleases = getFilteredReleases(group);
          const groupedReleases = groupReleasesByFormatBucket<SearchRelease>(filteredReleases);
          const isExpanded = Boolean(expandedGroups[group.releaseGroupId]);
          const loadingGroup = Boolean(loadingGroupIds[group.releaseGroupId]);
          const releaseCount = group.totalReleases;
          const canExpand = releaseCount > 1;
          const discogsSearchUrl = `https://www.discogs.com/search/?q=${encodeURIComponent(
            `${group.artist} ${group.title}`,
          )}&type=master`;
          const discogsGroupUrl = group.discogsMasterUrl ?? details?.discogsMasterUrl ?? discogsSearchUrl;
          const groupOwned = isGroupOwned(group.releaseGroupId);

          return (
            <div key={group.releaseGroupId} className="bg-vinyl-800 rounded-xl border border-vinyl-700 overflow-hidden">
              {/* Not a <button> — it contains the MusicBrainz/Discogs links
                  below, and interactive elements can't nest inside a button
                  (invalid HTML, breaks screen readers). Clicking this area
                  still toggles expansion for mouse users; the "Show releases"
                  control below is the real, keyboard-accessible button. */}
              <div
                onClick={() => toggleGroupExpanded(group)}
                className="w-full text-left p-4 flex flex-col sm:flex-row gap-4 hover:bg-vinyl-700/30 transition-colors cursor-pointer"
              >
                <div className="flex gap-4 flex-1 min-w-0">
                  <div className="w-20 h-20 rounded-md overflow-hidden border border-vinyl-700 shrink-0 bg-vinyl-900">
                    {renderCoverThumb(`group-${group.releaseGroupId}`, group.title, group.thumbnailUrl, 'No group art')}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-bold text-white truncate min-w-0">{group.title}</h3>
                      <div className="flex items-center gap-2 shrink-0">
                        {group.primaryType && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-vinyl-700 text-gray-300">
                            {group.primaryType}
                          </span>
                        )}
                        {groupOwned && (
                          <span
                            className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-700 text-green-100"
                            title="You already own at least one pressing of this release"
                          >
                            In Collection
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-gray-400 truncate">{group.artist}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {[group.firstReleaseDate?.slice(0, 4), `${releaseCount} release${releaseCount === 1 ? '' : 's'}`]
                        .filter(Boolean)
                        .join(' • ')}
                    </p>
                    <p className="text-xs text-gray-500 mt-1 truncate">
                      {`Formats: ${group.availableFormats.length > 0 ? group.availableFormats.join(', ') : 'Unknown'}`}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
                      <a
                        href={group.releaseGroupUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-vinyl-accent hover:text-white underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        MusicBrainz Group
                      </a>
                      <a
                        href={discogsGroupUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-vinyl-accent hover:text-white underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {group.discogsMasterUrl || details?.discogsMasterUrl ? 'Discogs Master' : 'Discogs Search'}
                      </a>
                    </div>
                  </div>
                </div>

                <div className="sm:self-center shrink-0">
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleGroupExpanded(group);
                    }}
                    className="w-full sm:w-auto sm:min-w-[160px] px-4 py-2 rounded-lg border border-vinyl-600 bg-vinyl-900 text-sm text-gray-200 flex items-center justify-center gap-2 hover:bg-vinyl-700 transition-colors"
                  >
                    <span>{canExpand ? (isExpanded ? 'Hide releases' : 'Show releases') : 'Single release'}</span>
                    <span className={`text-base leading-none transition-transform ${isExpanded ? 'rotate-180' : ''}`}>⌄</span>
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="px-4 pb-4 space-y-3 border-t border-vinyl-700/70">
                  {(!details || loadingGroup) && (
                    <div className="text-sm text-gray-400 py-3">Loading release variants...</div>
                  )}

                  {details && filteredReleases.length === 0 && (
                    <div className="text-sm text-gray-500 py-3">
                      No releases in this group match the selected formats.
                    </div>
                  )}

                  {groupedReleases.map(({ bucket, releases }) => (
                    <div key={bucket}>
                      <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2 mt-3 first:mt-0">
                        {bucket}
                      </h5>
                      <div className="space-y-3">
                        {releases.map((record) => {
                          const country = formatCountry(record.country);
                          const alreadyOwned = isReleaseOwned(record);
                          return (
                            <div key={record.id} className="flex bg-vinyl-900 rounded-lg p-3 border border-vinyl-700 gap-3">
                              <div className="w-20 h-20 rounded-md overflow-hidden border border-vinyl-700 shrink-0">
                                {renderCoverThumb(record.id, record.title, [record.coverUrl, group.thumbnailUrl])}
                              </div>
                              <div className="min-w-0 flex-1 flex flex-col justify-between">
                                <div>
                                  <h4 className="font-bold text-white truncate">{record.title}</h4>
                                  <p className="text-sm text-gray-400 truncate">{record.artist}</p>
                                  <p className="text-xs text-gray-500 mt-1 truncate">
                                    {[record.year, country, record.format, record.releaseStatus, record.genre]
                                      .filter(Boolean)
                                      .join(' • ') || 'Metadata unavailable'}
                                  </p>
                                  <p className="text-xs text-gray-500 truncate">
                                    {record.edition ? `${record.edition} • ` : ''}
                                    {record.musicBrainzId && (
                                      <a
                                        href={record.releaseUrl ?? `https://musicbrainz.org/release/${record.musicBrainzId}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-vinyl-accent hover:text-white underline"
                                      >
                                        MBID {record.musicBrainzId.slice(0, 8)}
                                      </a>
                                    )}
                                  </p>
                                </div>
                                <button
                                  onClick={() => !alreadyOwned && void handleAddToCollection(record)}
                                  disabled={alreadyOwned}
                                  className={
                                    alreadyOwned
                                      ? 'self-end text-xs bg-green-700 text-green-100 px-3 py-1 rounded cursor-default'
                                      : 'self-end text-xs bg-vinyl-accent hover:bg-red-500 text-white px-3 py-1 rounded transition-colors'
                                  }
                                >
                                  {alreadyOwned ? 'In Collection' : 'Add to Collection'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!isSearching && search.q && searchPage.total === 0 && (
        <div className="text-center text-gray-500 mt-10">
          No results found. Try a different query.
        </div>
      )}

      {!isSearching && search.q && searchPage.total > 0 && filteredGroups.length === 0 && (
        <div className="text-center text-gray-500 mt-10">
          {`${searchPage.groups.length} release group${searchPage.groups.length === 1 ? '' : 's'} found on this page, but none match your selected filters above.`}
        </div>
      )}

      {(searchPage.hasMore || searchPage.page > 1) && (
        <div className="mt-8 flex items-center justify-center gap-2">
          <button
            disabled={searchPage.page <= 1 || isSearching}
            onClick={() => goToPage(searchPage.page - 1)}
            className="px-4 py-2 rounded bg-vinyl-800 border border-vinyl-700 disabled:opacity-50"
          >
            Prev
          </button>
          <span className="text-sm text-gray-400 px-2">{`Page ${searchPage.page} / ${totalPages}`}</span>
          <button
            disabled={!searchPage.hasMore || isSearching}
            onClick={() => goToPage(searchPage.page + 1)}
            className="px-4 py-2 rounded bg-vinyl-800 border border-vinyl-700 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FilterDropdown } from '../components/FilterDropdown';
import { Icons } from '../components/Icons';
import { ReleaseGroupResultsList } from '../components/ReleaseGroupResultsList';
import { useAddToCollectionMutation, useCollectionQuery } from '../hooks/useCollection';
import {
  bucketForFormat,
  FilterState,
  formatBucketsForGroup,
  loadStoredFilterState,
  sortFormatBuckets,
  sortTypeBuckets,
  typeBucketForGroup,
} from '../lib/filters';
import { logEvent, logWarn } from '../services/telemetry';
import { getReleaseGroupReleases, searchVinylReleaseGroups } from '../services/vinylService';
import { SearchGroupReleases, SearchResultGroup, SearchResultPage, VinylRecord } from '../types';

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
    <div className="p-4 md:p-8 pb-28 md:pb-24">
      <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white mb-5 md:mb-6">Discover</h2>
      <div className="flex flex-col gap-3 mb-5">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none [&>svg]:w-4.5 [&>svg]:h-4.5">
              <Icons.Search />
            </span>
            <input
              type="search"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitSearch()}
              placeholder="Search artist or album..."
              className="w-full bg-vinyl-800/80 text-white placeholder:text-gray-500 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm focus:border-vinyl-accent/60 focus:ring-2 focus:ring-vinyl-accent/20 focus:outline-none transition-colors"
            />
          </div>
          <button
            onClick={submitSearch}
            disabled={isSearching}
            className="bg-gradient-to-br from-vinyl-accent to-red-500 hover:from-vinyl-accent-soft hover:to-red-400 text-white px-5 md:px-6 rounded-xl transition-colors font-semibold text-sm disabled:opacity-50"
          >
            Search
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
              />
            )}
          </div>
        )}
      </div>

      {isSearching && (
        <div className="space-y-3" aria-label="Loading search results" role="status">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-vinyl-800/60 rounded-2xl border border-white/5 p-4 flex gap-4 animate-pulse">
              <div className="w-20 h-20 rounded-xl bg-white/5 shrink-0" />
              <div className="flex-1 min-w-0 py-1 space-y-2.5">
                <div className="h-4 bg-white/10 rounded-md w-1/2" />
                <div className="h-3 bg-white/5 rounded-md w-1/3" />
                <div className="h-3 bg-white/5 rounded-md w-2/3" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!isSearching && searchPage.total > 0 && (
        <div className="mb-4 text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
          <span>{`${searchPage.total.toLocaleString()} matching release groups`}</span>
          <span>{`Page ${searchPage.page} of ${totalPages}`}</span>
          <span>{`${filteredGroups.length} of ${searchPage.groups.length} shown on this page`}</span>
        </div>
      )}

      {!isSearching && (
        <ReleaseGroupResultsList
          groups={filteredGroups}
          groupReleases={groupReleases}
          expandedGroups={expandedGroups}
          loadingGroupIds={loadingGroupIds}
          onToggleGroup={(group) => {
            void toggleGroupExpanded(group);
          }}
          getVisibleReleases={getFilteredReleases}
          showFormatBuckets
          isGroupOwned={isGroupOwned}
          isReleaseActionDisabled={isReleaseOwned}
          getReleaseActionLabel={(_, disabled) => (disabled ? 'In Collection' : 'Add to Collection')}
          getReleaseActionClassName={(_, disabled) =>
            disabled
              ? 'self-end text-xs font-semibold bg-green-500/15 border border-green-500/20 text-green-400 px-3.5 py-1.5 rounded-full cursor-default'
              : 'self-end text-xs font-semibold bg-gradient-to-br from-vinyl-accent to-red-500 hover:from-vinyl-accent-soft hover:to-red-400 text-white px-3.5 py-1.5 rounded-full transition-colors'}
          onReleaseAction={(record) => {
            void handleAddToCollection(record);
          }}
          emptyReleasesMessage="No releases in this group match the selected formats."
        />
      )}

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

      {!isSearching && (searchPage.hasMore || searchPage.page > 1) && (
        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            disabled={searchPage.page <= 1 || isSearching}
            onClick={() => goToPage(searchPage.page - 1)}
            className="px-4 py-2 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 text-sm font-medium text-gray-200 transition-colors disabled:opacity-40 disabled:hover:bg-white/5"
          >
            Previous
          </button>
          <span className="text-xs text-gray-500 tabular-nums px-1">{`${searchPage.page} / ${totalPages}`}</span>
          <button
            disabled={!searchPage.hasMore || isSearching}
            onClick={() => goToPage(searchPage.page + 1)}
            className="px-4 py-2 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 text-sm font-medium text-gray-200 transition-colors disabled:opacity-40 disabled:hover:bg-white/5"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

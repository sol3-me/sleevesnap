import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AdvancedSearchFields, AdvancedSearchFieldsValue } from '../components/AdvancedSearchFields';
import { FilterDropdown } from '../components/FilterDropdown';
import { Icons } from '../components/Icons';
import { ReleaseGroupResultsList } from '../components/ReleaseGroupResultsList';
import { useAddToCollectionMutation, useCollectionQuery } from '../hooks/useCollection';
import { useSettingsQuery } from '../hooks/useSettings';
import { getBrowserLocales, resolveEffectivePreferredRegion } from '../lib/detectRegionFromLocale';
import {
  FilterState,
  loadStoredFilterState,
  pickRepresentativeRelease,
  sortTypeBuckets,
  typeBucketForGroup,
} from '../lib/filters';
import { resolveArtistEntityByName } from '../lib/entityResolvers';
import { logEvent, logWarn } from '../services/telemetry';
import {
  DiscoverSearchType,
  getReleaseGroupReleases,
  searchArtistEntities,
  searchLabelEntities,
  searchVinylReleaseGroups,
} from '../services/vinylService';
import {
  ArtistSearchEntity,
  LabelSearchEntity,
  SearchEntityPage,
  SearchGroupReleases,
  SearchResultGroup,
  SearchResultPage,
  VinylRecord,
} from '../types';

const routeApi = getRouteApi('/discover');

const SEARCH_PAGE_SIZE = 10;
const ENTITY_PAGE_SIZE = 10;
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

const defaultArtistEntityPage: SearchEntityPage<ArtistSearchEntity> = {
  query: '',
  page: 1,
  pageSize: ENTITY_PAGE_SIZE,
  total: 0,
  hasMore: false,
  entities: [],
};

const defaultLabelEntityPage: SearchEntityPage<LabelSearchEntity> = {
  query: '',
  page: 1,
  pageSize: ENTITY_PAGE_SIZE,
  total: 0,
  hasMore: false,
  entities: [],
};

export function DiscoverView() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const { data: collection } = useCollectionQuery();
  const addMutation = useAddToCollectionMutation();
  const { data: settings } = useSettingsQuery();
  const representativePreferences = useMemo(
    () => ({
      preferredFormat: settings.preferredFormat,
      preferredRegion: resolveEffectivePreferredRegion(settings.preferredRegion, getBrowserLocales()),
    }),
    [settings.preferredFormat, settings.preferredRegion],
  );

  const [searchMode, setSearchMode] = useState<'simple' | 'advanced'>(search.m ?? 'simple');
  const [simpleSearchType, setSimpleSearchType] = useState<DiscoverSearchType>(search.st ?? 'title');
  const [inputValue, setInputValue] = useState(search.q ?? '');
  const [advancedFields, setAdvancedFields] = useState<AdvancedSearchFieldsValue>({
    title: search.title ?? '',
    artist: search.artist ?? '',
    year: search.year ?? '',
    label: search.label ?? '',
  });
  const [searchPage, setSearchPage] = useState<SearchResultPage>(defaultSearchPage);
  const [artistEntityPage, setArtistEntityPage] = useState<SearchEntityPage<ArtistSearchEntity>>(defaultArtistEntityPage);
  const [labelEntityPage, setLabelEntityPage] = useState<SearchEntityPage<LabelSearchEntity>>(defaultLabelEntityPage);
  const [groupReleases, setGroupReleases] = useState<Record<string, SearchGroupReleases>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [loadingGroupIds, setLoadingGroupIds] = useState<Record<string, true>>({});
  const [typeFilters, setTypeFilters] = useState<FilterState>(() => loadStoredFilterState(SEARCH_TYPE_FILTERS_KEY));
  const [discoveredTypeBuckets, setDiscoveredTypeBuckets] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchingEntities, setIsSearchingEntities] = useState(false);
  const releasesRef = useRef<Record<string, SearchGroupReleases>>({});
  const loadingRef = useRef<Set<string>>(new Set());
  const previousQueryRef = useRef<string | undefined>(undefined);
  const isCondensingPagesRef = useRef(false);
  const [condensedPageSkipCount, setCondensedPageSkipCount] = useState(0);

  useEffect(() => {
    setSearchMode(search.m ?? 'simple');
    setSimpleSearchType(search.st ?? 'title');
    setInputValue(search.q ?? '');
    setAdvancedFields({
      title: search.title ?? '',
      artist: search.artist ?? '',
      year: search.year ?? '',
      label: search.label ?? '',
    });
  }, [search.m, search.st, search.q, search.title, search.artist, search.year, search.label]);

  const isSimpleModeFromUrl = (search.m ?? 'simple') === 'simple';
  const simpleTypeFromUrl = search.st ?? 'title';
  const isEntitySelectionType =
    isSimpleModeFromUrl && (simpleTypeFromUrl === 'artist' || simpleTypeFromUrl === 'label');
  const shouldShowEntityPicker = Boolean(
    isEntitySelectionType &&
    search.q?.trim(),
  );

  const hasCommittedGroupSearch = Boolean(
    (search.m === 'advanced' && (search.title || search.artist || search.year || search.label)) ||
    (
      isSimpleModeFromUrl &&
      (
        simpleTypeFromUrl === 'title' && search.q
      )
    ),
  );

  const getSearchRequestFromUrl = useCallback(() => {
    if ((search.m ?? 'simple') === 'advanced') {
      const intent = {
        title: search.title?.trim() || undefined,
        artist: search.artist?.trim() || undefined,
        year: search.year?.trim() || undefined,
        label: search.label?.trim() || undefined,
      };

      if (!intent.title && !intent.artist && !intent.year && !intent.label) {
        return undefined;
      }

      return {
        mode: 'indexed' as const,
        intent,
      };
    }

    const q = search.q?.trim();
    if (!q) return undefined;

    const searchType = search.st ?? 'title';
    if (searchType !== 'title') {
      return undefined;
    }

    return {
      mode: 'indexed' as const,
      intent: { title: q },
    };
  }, [search.m, search.q, search.st, search.title, search.artist, search.year, search.label]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SEARCH_TYPE_FILTERS_KEY, JSON.stringify(typeFilters));
    } catch {
      // Ignore storage write failures.
    }
  }, [typeFilters]);

  const runSearch = useCallback(async (page: number, isNewQuery: boolean) => {
    const request = getSearchRequestFromUrl();
    if (!request) return;

    setIsSearching(true);
    const startedAt = performance.now();

    try {
      const result = await searchVinylReleaseGroups({
        ...request,
        page,
        pageSize: SEARCH_PAGE_SIZE,
      });
      const telemetryQuery = result.query || search.q || search.title || search.artist || search.label || '';
      logEvent('discover', 'Search results', {
        query: telemetryQuery,
        page,
        total: result.total,
        returned: result.groups.length,
        top: result.groups.slice(0, 3).map((g) => `${g.artist} - ${g.title}`),
        ms: Math.round(performance.now() - startedAt),
      });
      setSearchPage(result);
      // Accumulate type buckets across pages of the same query (so
      // checkboxes don't disappear/reappear while paging), but start fresh
      // for a brand new query.
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
      logWarn('discover', 'Search failed', {
        mode: search.m ?? 'simple',
        query: search.q,
        title: search.title,
        artist: search.artist,
        year: search.year,
        label: search.label,
        page,
        error: err instanceof Error ? err.message : String(err),
      });
      toast.error('Search failed. Please try again.');
    } finally {
      setIsSearching(false);
    }
  }, [getSearchRequestFromUrl, search.m, search.q, search.title, search.artist, search.year, search.label]);

  useEffect(() => {
    if (!shouldShowEntityPicker) {
      return;
    }

    let cancelled = false;
    setIsSearchingEntities(true);

    void (async () => {
      try {
        const query = search.q?.trim() ?? '';
        if (!query) return;

        if (simpleTypeFromUrl === 'artist') {
          const result = await searchArtistEntities({ query, page: 1, pageSize: ENTITY_PAGE_SIZE });
          if (!cancelled) {
            setArtistEntityPage(result);
          }
          return;
        }

        const result = await searchLabelEntities({ query, page: 1, pageSize: ENTITY_PAGE_SIZE });
        if (!cancelled) {
          setLabelEntityPage(result);
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(
            simpleTypeFromUrl === 'artist'
              ? 'Artist lookup failed. Please try again.'
              : 'Label lookup failed. Please try again.',
          );
          if (simpleTypeFromUrl === 'artist') {
            setArtistEntityPage(defaultArtistEntityPage);
          } else {
            setLabelEntityPage(defaultLabelEntityPage);
          }
        }
      } finally {
        if (!cancelled) {
          setIsSearchingEntities(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shouldShowEntityPicker, simpleTypeFromUrl, search.q]);

  useEffect(() => {
    const identity = JSON.stringify({
      mode: search.m ?? 'simple',
      st: search.st ?? 'title',
      q: search.q ?? '',
      title: search.title ?? '',
      artist: search.artist ?? '',
      year: search.year ?? '',
      label: search.label ?? '',
    });

    if (!hasCommittedGroupSearch) return;

    const isNewQuery = previousQueryRef.current !== identity;
    previousQueryRef.current = identity;
    void runSearch(search.page ?? 1, isNewQuery);
  }, [search.m, search.st, search.q, search.title, search.artist, search.year, search.label, search.page, hasCommittedGroupSearch, runSearch]);

  const submitSearch = () => {
    if (searchMode === 'advanced') {
      const title = advancedFields.title.trim();
      const artist = advancedFields.artist.trim();
      const year = advancedFields.year.trim();
      const label = advancedFields.label.trim();
      if (!title && !artist && !year && !label) return;

      void navigate({
        search: {
          m: 'advanced',
          st: undefined,
          q: undefined,
          title: title || undefined,
          artist: artist || undefined,
          year: year || undefined,
          label: label || undefined,
          page: 1,
        },
      });
      return;
    }

    const trimmed = inputValue.trim();
    if (!trimmed) return;
    void navigate({
      search: {
        m: 'simple',
        st: simpleSearchType,
        q: trimmed,
        title: undefined,
        artist: undefined,
        year: undefined,
        label: undefined,
        page: 1,
      },
    });
  };

  const goToPage = (page: number) => {
    void navigate({ search: (prev) => ({ ...prev, page }) });
  };

  const chooseArtistEntity = (entity: ArtistSearchEntity) => {
    const name = entity.name.trim() || search.q?.trim() || 'Unknown Artist';
    void navigate({
      to: '/artists/$artistId',
      params: { artistId: entity.id },
      search: {
        name,
        page: 1,
      },
    });
  };

  const chooseLabelEntity = (entity: LabelSearchEntity) => {
    const name = entity.name.trim() || search.q?.trim() || 'Unknown Label';
    void navigate({
      to: '/labels/$labelId',
      params: { labelId: entity.id },
      search: {
        name,
        page: 1,
      },
    });
  };

  const openArtistDetailFromCard = useCallback(async (artistName: string) => {
    const trimmed = artistName.trim();
    if (!trimmed) return;

    try {
      const artist = await resolveArtistEntityByName(trimmed);
      if (!artist) {
        toast.error('Could not find a matching artist detail page.');
        return;
      }

      await navigate({
        to: '/artists/$artistId',
        params: { artistId: artist.id },
        search: { name: artist.name, page: 1 },
      });
    } catch {
      toast.error('Failed to open artist detail page. Please try again.');
    }
  }, [navigate]);

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

  const isTypeBucketChecked = useCallback(
    (bucket: string) => typeFilters[bucket] ?? true,
    [typeFilters],
  );

  const groupMatchesFilters = useCallback(
    (group: SearchResultGroup) => isTypeBucketChecked(typeBucketForGroup(group)),
    [isTypeBucketChecked],
  );

  const sortedTypeBuckets = useMemo(() => {
    return sortTypeBuckets(discoveredTypeBuckets);
  }, [discoveredTypeBuckets]);

  const shouldApplyClientFilters = !isEntitySelectionType;

  const showGroupFilters =
    shouldApplyClientFilters &&
    !shouldShowEntityPicker &&
    sortedTypeBuckets.length > 0;

  const activeEntityPage = simpleTypeFromUrl === 'artist' ? artistEntityPage : labelEntityPage;
  const activeEntityCount = activeEntityPage.entities.length;

  const filteredGroups = useMemo(() => {
    if (!shouldApplyClientFilters) {
      return searchPage.groups;
    }
    return searchPage.groups.filter(groupMatchesFilters);
  }, [searchPage.groups, groupMatchesFilters, shouldApplyClientFilters]);

  const hasActiveClientFilters = useMemo(() => {
    if (!shouldApplyClientFilters) {
      return false;
    }
    return sortedTypeBuckets.some((bucket) => !isTypeBucketChecked(bucket));
  }, [sortedTypeBuckets, isTypeBucketChecked, shouldApplyClientFilters]);

  const totalPages = Math.max(1, Math.ceil(searchPage.total / searchPage.pageSize));

  const findNextPageWithFilteredResults = useCallback(
    async (startPage: number): Promise<{ page: number; skipped: number } | undefined> => {
      const request = getSearchRequestFromUrl();
      if (!request) return undefined;

      const maxProbePages = 12;

      for (let offset = 1; offset <= maxProbePages; offset += 1) {
        const page = startPage + offset;
        const result = await searchVinylReleaseGroups({
          ...request,
          page,
          pageSize: SEARCH_PAGE_SIZE,
        });

        if (result.groups.some(groupMatchesFilters)) {
          return {
            page,
            skipped: offset,
          };
        }

        if (!result.hasMore) {
          return undefined;
        }
      }

      return undefined;
    },
    [getSearchRequestFromUrl, groupMatchesFilters],
  );

  useEffect(() => {
    const shouldCondense =
      !isSearching &&
      hasCommittedGroupSearch &&
      hasActiveClientFilters &&
      filteredGroups.length === 0 &&
      searchPage.groups.length > 0 &&
      searchPage.hasMore;

    if (!shouldCondense || isCondensingPagesRef.current) {
      return;
    }

    isCondensingPagesRef.current = true;

    void (async () => {
      try {
        const next = await findNextPageWithFilteredResults(searchPage.page);
        if (!next) return;

        setCondensedPageSkipCount(next.skipped);
        await navigate({
          search: (prev) => ({ ...prev, page: next.page }),
          replace: true,
        });
      } finally {
        isCondensingPagesRef.current = false;
      }
    })();
  }, [
    filteredGroups.length,
    findNextPageWithFilteredResults,
    hasActiveClientFilters,
    hasCommittedGroupSearch,
    isSearching,
    navigate,
    searchPage.groups.length,
    searchPage.hasMore,
    searchPage.page,
  ]);

  useEffect(() => {
    if (filteredGroups.length > 0 || !hasActiveClientFilters) {
      setCondensedPageSkipCount(0);
    }
  }, [filteredGroups.length, hasActiveClientFilters, searchPage.page]);

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

  // Mainstream path: add a sensible pressing straight from the collapsed
  // card, no need to expand and pick a specific region first. Fetches
  // on-demand (only when actually clicked, unlike the old eager
  // auto-expand-everything approach) and reuses whatever's already cached.
  const handleQuickAdd = async (group: SearchResultGroup) => {
    try {
      const detail = await loadReleasesForGroup(group.releaseGroupId);
      const releases = detail?.releases ?? groupReleases[group.releaseGroupId]?.releases ?? [];
      if (releases.length === 0) {
        toast.error(`Couldn't load releases for "${group.title}". Please try again.`);
        return;
      }
      await handleAddToCollection(pickRepresentativeRelease(releases, representativePreferences));
    } catch {
      toast.error(`Couldn't load releases for "${group.title}". Please try again.`);
    }
  };

  return (
    <div className="p-4 md:p-8 pb-28 md:pb-24">
      <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white mb-5 md:mb-6">Discover</h2>
      <div className="flex flex-col gap-3 mb-5">
        <div className={`flex flex-wrap items-center gap-3 ${showGroupFilters ? 'justify-between' : 'justify-end'}`}>
          {showGroupFilters && (
            <div className="flex flex-wrap items-center gap-3">
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

          <div className="inline-flex w-fit rounded-xl border border-white/10 bg-vinyl-800/60 p-1 md:ml-auto">
            <button
              type="button"
              onClick={() => setSearchMode('simple')}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${searchMode === 'simple' ? 'bg-vinyl-accent text-white' : 'text-gray-300 hover:text-white'
                }`}
            >
              Simple Search
            </button>
            <button
              type="button"
              onClick={() => setSearchMode('advanced')}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${searchMode === 'advanced' ? 'bg-vinyl-accent text-white' : 'text-gray-300 hover:text-white'
                }`}
            >
              Advanced Search
            </button>
          </div>
        </div>

        <div className="flex items-start gap-2">
          <div className="flex-1">
            {searchMode === 'simple' ? (
              <div className="flex gap-2">
                <select
                  value={simpleSearchType}
                  onChange={(e) => setSimpleSearchType(e.target.value as DiscoverSearchType)}
                  className="bg-vinyl-800/80 text-white border border-white/10 rounded-xl px-3 py-3 text-sm focus:border-vinyl-accent/60 focus:ring-2 focus:ring-vinyl-accent/20 focus:outline-none transition-colors"
                >
                  <option value="title">Title</option>
                  <option value="artist">Artist</option>
                  <option value="label">Label</option>
                </select>
                <div className="relative flex-1">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none [&>svg]:w-4.5 [&>svg]:h-4.5">
                    <Icons.Search />
                  </span>
                  <input
                    type="search"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submitSearch()}
                    placeholder={`Search by ${simpleSearchType}...`}
                    className="w-full bg-vinyl-800/80 text-white placeholder:text-gray-500 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm focus:border-vinyl-accent/60 focus:ring-2 focus:ring-vinyl-accent/20 focus:outline-none transition-colors"
                  />
                </div>
              </div>
            ) : (
              <AdvancedSearchFields value={advancedFields} onChange={setAdvancedFields} onSubmit={submitSearch} />
            )}
          </div>

          <button
            onClick={submitSearch}
            disabled={isSearching || isSearchingEntities}
            className="bg-gradient-to-br from-vinyl-accent to-red-500 hover:from-vinyl-accent-soft hover:to-red-400 text-white px-5 md:px-6 h-12 rounded-xl transition-colors font-semibold text-sm disabled:opacity-50"
          >
            Search
          </button>
        </div>
      </div>

      {shouldShowEntityPicker && (
        <div className="mb-5 space-y-3">
          <div className="text-sm text-gray-400">
            {simpleTypeFromUrl === 'artist'
              ? 'Select the exact artist to search their specific discography.'
              : 'Select the exact label to search releases tied to that label.'}
          </div>

          {isSearchingEntities ? (
            <div className="space-y-2" role="status" aria-label="Loading entity matches">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-14 rounded-xl bg-vinyl-800/60 border border-white/5 animate-pulse" />
              ))}
            </div>
          ) : activeEntityCount === 0 ? (
            <div className="text-sm text-gray-500">No matching entities found. Try refining your search.</div>
          ) : (
            <>
              <div className="text-xs text-gray-500">
                {`${activeEntityPage.total.toLocaleString()} matching ${simpleTypeFromUrl === 'artist' ? 'artists' : 'labels'} · showing ${activeEntityCount}`}
              </div>
              <div className="space-y-2">
                {simpleTypeFromUrl === 'artist'
                  ? artistEntityPage.entities.map((entity) => (
                    <button
                      key={entity.id}
                      type="button"
                      onClick={() => chooseArtistEntity(entity)}
                      className="w-full text-left rounded-xl border border-white/10 bg-vinyl-800/60 hover:bg-vinyl-700/60 transition-colors p-3"
                    >
                      <div className="font-medium text-white text-sm">{entity.name}</div>
                      <div className="mt-1 text-xs text-gray-400">
                        {[entity.disambiguation, entity.area ?? entity.country, entity.type]
                          .filter(Boolean)
                          .join(' · ') || 'No extra metadata'}
                      </div>
                    </button>
                  ))
                  : labelEntityPage.entities.map((entity) => (
                    <button
                      key={entity.id}
                      type="button"
                      onClick={() => chooseLabelEntity(entity)}
                      className="w-full text-left rounded-xl border border-white/10 bg-vinyl-800/60 hover:bg-vinyl-700/60 transition-colors p-3"
                    >
                      <div className="font-medium text-white text-sm">{entity.name}</div>
                      <div className="mt-1 text-xs text-gray-400">
                        {[entity.disambiguation, entity.area ?? entity.country, entity.type, entity.labelCode ? `LC ${entity.labelCode}` : undefined]
                          .filter(Boolean)
                          .join(' · ') || 'No extra metadata'}
                      </div>
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>
      )}

      {!shouldShowEntityPicker && isSearching && (
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

      {!shouldShowEntityPicker && !isSearching && searchPage.total > 0 && (
        <div className="mb-4 text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
          <span>{`${searchPage.total.toLocaleString()} matching release groups`}</span>
          <span>{`Page ${searchPage.page} of ${totalPages}`}</span>
          <span>{`${filteredGroups.length} of ${searchPage.groups.length} shown on this page`}</span>
          {condensedPageSkipCount > 0 && (
            <span>{`Skipped ${condensedPageSkipCount} page${condensedPageSkipCount === 1 ? '' : 's'} with no filter matches`}</span>
          )}
        </div>
      )}

      {!shouldShowEntityPicker && !isSearching && (
        <ReleaseGroupResultsList
          groups={filteredGroups}
          groupReleases={groupReleases}
          expandedGroups={expandedGroups}
          loadingGroupIds={loadingGroupIds}
          onToggleGroup={(group) => {
            void toggleGroupExpanded(group);
          }}
          onQuickAdd={handleQuickAdd}
          showFormatBuckets
          preferences={representativePreferences}
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
          onArtistNameClick={(artistName) => {
            void openArtistDetailFromCard(artistName);
          }}
        />
      )}

      {!shouldShowEntityPicker && !isSearching && hasCommittedGroupSearch && searchPage.total === 0 && (
        <div className="text-center text-gray-500 mt-10">
          No results found. Try a different query.
        </div>
      )}

      {!shouldShowEntityPicker && !isSearching && hasCommittedGroupSearch && searchPage.total > 0 && filteredGroups.length === 0 && (
        <div className="text-center text-gray-500 mt-10">
          {`${searchPage.groups.length} release group${searchPage.groups.length === 1 ? '' : 's'} found on this page, but none match your selected filters above.`}
        </div>
      )}

      {!shouldShowEntityPicker && !isSearching && (searchPage.hasMore || searchPage.page > 1) && (
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

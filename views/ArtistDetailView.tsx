import { Link, getRouteApi } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ReleaseGroupResultsList } from '../components/ReleaseGroupResultsList';
import { useAddToCollectionMutation, useCollectionQuery } from '../hooks/useCollection';
import { resolveArtistEntityByName } from '../lib/entityResolvers';
import { pickRepresentativeRelease } from '../lib/filters';
import { getReleaseGroupReleases, searchVinylReleaseGroups } from '../services/vinylService';
import { SearchGroupReleases, SearchResultGroup, SearchResultPage, VinylRecord } from '../types';

const routeApi = getRouteApi('/artists/$artistId');

const DETAIL_FETCH_PAGE_SIZE = 20;
const DEFAULT_DETAIL_TAB: DetailTabKey = 'albums';

type DetailTabKey = 'albums' | 'singles' | 'others';

interface DetailTabConfig {
  key: DetailTabKey;
  label: string;
  includePrimaryTypes?: string[];
  excludePrimaryTypes?: string[];
}

interface DetailTabState {
  initialized: boolean;
  page: SearchResultPage;
}

const DETAIL_TABS: DetailTabConfig[] = [
  { key: 'albums', label: 'Albums', includePrimaryTypes: ['album'] },
  { key: 'singles', label: 'Singles', includePrimaryTypes: ['single', 'ep'] },
  { key: 'others', label: 'Other', excludePrimaryTypes: ['album', 'single', 'ep'] },
];

const TAB_CONFIG_BY_KEY: Record<DetailTabKey, DetailTabConfig> = {
  albums: DETAIL_TABS[0],
  singles: DETAIL_TABS[1],
  others: DETAIL_TABS[2],
};

function createDefaultSearchPage(): SearchResultPage {
  return {
    query: '',
    page: 1,
    pageSize: DETAIL_FETCH_PAGE_SIZE,
    total: 0,
    hasMore: false,
    isTotalExact: false,
    groups: [],
  };
}

function mergeReleaseGroups(existing: SearchResultGroup[], incoming: SearchResultGroup[]): SearchResultGroup[] {
  return Array.from(new Map([...existing, ...incoming].map((group) => [group.releaseGroupId, group])).values());
}

function createInitialTabStates(): Record<DetailTabKey, DetailTabState> {
  return {
    albums: { initialized: false, page: createDefaultSearchPage() },
    singles: { initialized: false, page: createDefaultSearchPage() },
    others: { initialized: false, page: createDefaultSearchPage() },
  };
}

export function ArtistDetailView() {
  const { artistId } = routeApi.useParams();
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const { data: collection } = useCollectionQuery();
  const addMutation = useAddToCollectionMutation();

  const artistName = search.name?.trim() || 'Unknown Artist';

  const [activeTab, setActiveTab] = useState<DetailTabKey>(DEFAULT_DETAIL_TAB);
  const [tabStates, setTabStates] = useState<Record<DetailTabKey, DetailTabState>>(createInitialTabStates);
  const [groupReleases, setGroupReleases] = useState<Record<string, SearchGroupReleases>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [loadingGroupIds, setLoadingGroupIds] = useState<Record<string, true>>({});
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const releasesRef = useRef<Record<string, SearchGroupReleases>>({});
  const loadingRef = useRef<Set<string>>(new Set());
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const loadMoreInFlightRef = useRef(false);
  const initialTabLoadInFlightRef = useRef<Record<DetailTabKey, boolean>>({
    albums: false,
    singles: false,
    others: false,
  });

  const activeTabState = tabStates[activeTab];
  const activeSearchPage = activeTabState.page;

  const fetchTabPage = useCallback(
    async (tabKey: DetailTabKey, page: number, append: boolean) => {
      const tabConfig = TAB_CONFIG_BY_KEY[tabKey];
      const result = await searchVinylReleaseGroups({
        mode: 'indexed',
        intent: {
          artistId,
          artist: artistName,
          discographyBrowse: true,
          primaryTypes: tabConfig.includePrimaryTypes,
          excludePrimaryTypes: tabConfig.excludePrimaryTypes,
        },
        page,
        pageSize: DETAIL_FETCH_PAGE_SIZE,
      });

      setTabStates((prev) => {
        const previousTabPage = prev[tabKey].page;
        return {
          ...prev,
          [tabKey]: {
            initialized: true,
            page: {
              ...result,
              groups: append ? mergeReleaseGroups(previousTabPage.groups, result.groups) : result.groups,
            },
          },
        };
      });
    },
    [artistId, artistName],
  );

  const resetDetailState = useCallback(() => {
    setActiveTab(DEFAULT_DETAIL_TAB);
    setTabStates(createInitialTabStates());
    setIsSearching(false);
    setIsLoadingMore(false);
    loadMoreInFlightRef.current = false;
    initialTabLoadInFlightRef.current = {
      albums: false,
      singles: false,
      others: false,
    };
    setGroupReleases({});
    releasesRef.current = {};
    loadingRef.current.clear();
    setLoadingGroupIds({});
    setExpandedGroups({});
  }, []);

  useEffect(() => {
    resetDetailState();
  }, [artistId, artistName, resetDetailState]);

  const loadInitialTabPage = useCallback(
    async (tabKey: DetailTabKey) => {
      if (initialTabLoadInFlightRef.current[tabKey]) {
        return;
      }

      initialTabLoadInFlightRef.current[tabKey] = true;
      setIsSearching(true);
      setIsLoadingMore(false);
      loadMoreInFlightRef.current = false;

      try {
        await fetchTabPage(tabKey, 1, false);
      } catch {
        toast.error('Failed to load artist releases. Please try again.');
      } finally {
        initialTabLoadInFlightRef.current[tabKey] = false;
        setIsSearching(false);
      }
    },
    [fetchTabPage],
  );

  useEffect(() => {
    if (activeTabState.initialized) {
      return;
    }

    void loadInitialTabPage(activeTab);
  }, [activeTab, activeTabState.initialized, loadInitialTabPage]);

  const loadMore = useCallback(async () => {
    if (isSearching || !activeSearchPage.hasMore || loadMoreInFlightRef.current) {
      return;
    }

    loadMoreInFlightRef.current = true;
    setIsLoadingMore(true);
    try {
      await fetchTabPage(activeTab, activeSearchPage.page + 1, true);
    } catch {
      toast.error('Failed to load more artist releases. Please keep scrolling to retry.');
    } finally {
      loadMoreInFlightRef.current = false;
      setIsLoadingMore(false);
    }
  }, [activeSearchPage.hasMore, activeSearchPage.page, activeTab, fetchTabPage, isSearching]);

  useEffect(() => {
    if (!activeSearchPage.hasMore || isSearching) {
      return;
    }

    const target = loadMoreRef.current;
    if (!target) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry?.isIntersecting) {
          void loadMore();
        }
      },
      {
        root: null,
        rootMargin: '500px 0px',
        threshold: 0,
      },
    );

    observer.observe(target);

    return () => {
      observer.disconnect();
    };
  }, [activeSearchPage.groups.length, activeSearchPage.hasMore, isSearching, loadMore]);

  const openArtistDetailFromCard = useCallback(async (nameFromCard: string) => {
    const trimmed = nameFromCard.trim();
    if (!trimmed) return;

    try {
      if (trimmed.toLowerCase() === artistName.toLowerCase()) {
        await navigate({
          to: '/artists/$artistId',
          params: { artistId },
          search: { name: artistName, page: 1 },
        });
        return;
      }

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
  }, [artistId, artistName, navigate]);

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

  // Single-release groups gain nothing from the extra click — expand them as
  // soon as they appear, silently so it doesn't flash a loading state.
  useEffect(() => {
    const singles = activeSearchPage.groups.filter((group) => group.totalReleases === 1);
    if (singles.length === 0) return;

    setExpandedGroups((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const group of singles) {
        if (!next[group.releaseGroupId]) {
          next[group.releaseGroupId] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    for (const group of singles) {
      void loadReleasesForGroup(group.releaseGroupId, true);
    }
  }, [activeSearchPage.groups, loadReleasesForGroup]);

  const toggleGroupExpanded = async (releaseGroupId: string) => {
    const isOpen = Boolean(expandedGroups[releaseGroupId]);
    const nextOpen = !isOpen;

    setExpandedGroups((prev) => ({
      ...prev,
      [releaseGroupId]: nextOpen,
    }));

    if (nextOpen) {
      await loadReleasesForGroup(releaseGroupId);
    }
  };

  const handleAddToCollection = async (record: VinylRecord) => {
    const success = await addMutation.mutateAsync(record);
    if (success) {
      toast.success(`Added "${record.title}" to collection`);
    } else {
      toast(`"${record.title}" is already in your collection`);
    }
  };

  // Mainstream path: add a sensible pressing straight from the collapsed
  // card, no need to expand and pick a specific region first.
  const handleQuickAdd = async (group: SearchResultGroup) => {
    try {
      const detail = await loadReleasesForGroup(group.releaseGroupId);
      const releases = detail?.releases ?? groupReleases[group.releaseGroupId]?.releases ?? [];
      if (releases.length === 0) {
        toast.error(`Couldn't load releases for "${group.title}". Please try again.`);
        return;
      }
      await handleAddToCollection(pickRepresentativeRelease(releases));
    } catch {
      toast.error(`Couldn't load releases for "${group.title}". Please try again.`);
    }
  };

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

  const collectionReleaseGroupIds = useMemo(
    () => new Set(collection.map((r) => r.releaseGroupId).filter((id): id is string => Boolean(id))),
    [collection],
  );

  const totalLabel = activeSearchPage.isTotalExact
    ? `${activeSearchPage.total.toLocaleString()} matching release groups`
    : `${activeSearchPage.total.toLocaleString()}+ matching release groups`;

  return (
    <div className="p-4 md:p-8 pb-28 md:pb-24">
      <div className="mb-4">
        <Link
          to="/discover"
          search={{
            m: 'simple',
            st: 'artist',
            q: artistName,
            aid: artistId,
            an: artistName,
            page: 1,
          }}
          className="text-xs text-gray-400 hover:text-white transition-colors"
        >
          Back to Discover
        </Link>
      </div>

      <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white">{artistName}</h2>
      <p className="text-xs text-gray-500 mt-1">Artist ID: {artistId}</p>

      <div className="mt-4 inline-flex rounded-xl border border-white/10 bg-vinyl-800/60 p-1">
        {DETAIL_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${activeTab === tab.key ? 'bg-vinyl-accent text-white' : 'text-gray-300 hover:text-white'
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {!isSearching && activeTabState.initialized && activeSearchPage.total > 0 && (
        <div className="mt-4 mb-4 text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
          <span>{totalLabel}</span>
          <span>{`${activeSearchPage.groups.length.toLocaleString()} loaded`}</span>
        </div>
      )}

      {isSearching ? (
        <div className="space-y-3 mt-4" aria-label="Loading artist releases" role="status">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 bg-vinyl-800/60 rounded-2xl border border-white/5 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="mt-4">
          <ReleaseGroupResultsList
            groups={activeSearchPage.groups}
            groupReleases={groupReleases}
            expandedGroups={expandedGroups}
            loadingGroupIds={loadingGroupIds}
            showReleaseCount={false}
            showFormatBuckets
            onToggleGroup={(group) => {
              void toggleGroupExpanded(group.releaseGroupId);
            }}
            onQuickAdd={handleQuickAdd}
            isGroupOwned={(releaseGroupId) => collectionReleaseGroupIds.has(releaseGroupId)}
            isReleaseActionDisabled={isReleaseOwned}
            getReleaseActionLabel={(_, disabled) => (disabled ? 'In Collection' : 'Add to Collection')}
            getReleaseActionClassName={(_, disabled) =>
              disabled
                ? 'self-end text-xs font-semibold bg-green-500/15 border border-green-500/20 text-green-400 px-3.5 py-1.5 rounded-full cursor-default'
                : 'self-end text-xs font-semibold bg-gradient-to-br from-vinyl-accent to-red-500 hover:from-vinyl-accent-soft hover:to-red-400 text-white px-3.5 py-1.5 rounded-full transition-colors'}
            onReleaseAction={(record) => {
              void handleAddToCollection(record);
            }}
            onArtistNameClick={(artistNameFromCard) => {
              void openArtistDetailFromCard(artistNameFromCard);
            }}
          />
        </div>
      )}

      {!isSearching && activeTabState.initialized && activeSearchPage.total === 0 && (
        <div className="text-center text-gray-500 mt-10">No release groups found in this tab.</div>
      )}

      {!isSearching && activeTabState.initialized && activeSearchPage.total > 0 && (
        <div className="mt-8 flex flex-col items-center gap-2 text-xs text-gray-500">
          {activeSearchPage.hasMore ? (
            <>
              <div ref={loadMoreRef} className="h-8 w-full" />
              <span>{isLoadingMore ? 'Loading more…' : 'Scroll to load more'}</span>
            </>
          ) : (
            <span>All results loaded</span>
          )}
        </div>
      )}
    </div>
  );
}

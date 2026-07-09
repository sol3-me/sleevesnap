import { Link, getRouteApi } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ReleaseGroupResultsList } from '../components/ReleaseGroupResultsList';
import { useAddToCollectionMutation, useCollectionQuery } from '../hooks/useCollection';
import { resolveArtistEntityByName } from '../lib/entityResolvers';
import { buildReleaseGroupSections } from '../lib/releaseGroupSections';
import { getReleaseGroupReleases, searchVinylReleaseGroups } from '../services/vinylService';
import { SearchGroupReleases, SearchResultGroup, SearchResultPage, VinylRecord } from '../types';

const routeApi = getRouteApi('/artists/$artistId');

const DETAIL_FETCH_PAGE_SIZE = 20;

interface DetailTypeBucket {
  includePrimaryTypes?: string[];
  excludePrimaryTypes?: string[];
}

interface DetailBucketProgress {
  nextPage: number;
  hasMore: boolean;
  total: number;
  initialized: boolean;
}

const DETAIL_TYPE_BUCKETS: DetailTypeBucket[] = [
  { includePrimaryTypes: ['album'] },
  { includePrimaryTypes: ['single', 'ep'] },
  { excludePrimaryTypes: ['album', 'single', 'ep'] },
];

function createInitialBucketProgress(): DetailBucketProgress[] {
  return DETAIL_TYPE_BUCKETS.map(() => ({
    nextPage: 1,
    hasMore: true,
    total: 0,
    initialized: false,
  }));
}

function findNextBucketIndex(progress: DetailBucketProgress[], startIndex = 0): number {
  for (let i = Math.max(0, startIndex); i < progress.length; i += 1) {
    const bucket = progress[i];
    if (!bucket) continue;
    if (!bucket.initialized || bucket.hasMore) {
      return i;
    }
  }
  return progress.length;
}

function mergeReleaseGroups(existing: SearchResultGroup[], incoming: SearchResultGroup[]): SearchResultGroup[] {
  return Array.from(new Map([...existing, ...incoming].map((group) => [group.releaseGroupId, group])).values());
}

const defaultSearchPage: SearchResultPage = {
  query: '',
  page: 1,
  pageSize: DETAIL_FETCH_PAGE_SIZE,
  total: 0,
  hasMore: false,
  isTotalExact: false,
  groups: [],
};

export function ArtistDetailView() {
  const { artistId } = routeApi.useParams();
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const { data: collection } = useCollectionQuery();
  const addMutation = useAddToCollectionMutation();

  const artistName = search.name?.trim() || 'Unknown Artist';

  const [searchPage, setSearchPage] = useState<SearchResultPage>(defaultSearchPage);
  const [groupReleases, setGroupReleases] = useState<Record<string, SearchGroupReleases>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [loadingGroupIds, setLoadingGroupIds] = useState<Record<string, true>>({});
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMorePages, setHasMorePages] = useState(false);
  const releasesRef = useRef<Record<string, SearchGroupReleases>>({});
  const loadingRef = useRef<Set<string>>(new Set());
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const loadMoreInFlightRef = useRef(false);
  const bucketProgressRef = useRef<DetailBucketProgress[]>(createInitialBucketProgress());
  const activeBucketIndexRef = useRef(0);

  const loadNextTypeBucketPage = useCallback(async () => {
    const progress = bucketProgressRef.current.map((entry) => ({ ...entry }));
    let bucketIndex = activeBucketIndexRef.current;
    let latestQuery: string | undefined;
    let loadedAny = false;

    while (bucketIndex < DETAIL_TYPE_BUCKETS.length) {
      const bucket = DETAIL_TYPE_BUCKETS[bucketIndex];
      const bucketProgress = progress[bucketIndex];

      if (!bucket || !bucketProgress) {
        bucketIndex += 1;
        continue;
      }

      if (bucketProgress.initialized && !bucketProgress.hasMore) {
        bucketIndex += 1;
        continue;
      }

      const pageToLoad = bucketProgress.nextPage;
      const result = await searchVinylReleaseGroups({
        mode: 'indexed',
        intent: {
          artistId,
          artist: artistName,
          primaryTypes: bucket.includePrimaryTypes,
          excludePrimaryTypes: bucket.excludePrimaryTypes,
        },
        page: pageToLoad,
        pageSize: DETAIL_FETCH_PAGE_SIZE,
      });

      latestQuery = result.query;
      loadedAny = loadedAny || result.groups.length > 0;

      setSearchPage((prev) => ({
        ...prev,
        query: result.query || prev.query,
        page: pageToLoad,
        groups: mergeReleaseGroups(prev.groups, result.groups),
      }));

      progress[bucketIndex] = {
        nextPage: pageToLoad + 1,
        hasMore: result.hasMore,
        total: result.total,
        initialized: true,
      };

      if (result.hasMore) {
        break;
      }

      bucketIndex += 1;
      if (loadedAny) {
        break;
      }
    }

    bucketProgressRef.current = progress;

    const nextBucketIndex = findNextBucketIndex(progress, bucketIndex);
    activeBucketIndexRef.current = nextBucketIndex;

    const hasMore = nextBucketIndex < DETAIL_TYPE_BUCKETS.length;
    const totalLoadedAcrossKnownBuckets = progress.reduce(
      (sum, entry) => sum + (entry.initialized ? entry.total : 0),
      0,
    );
    const allBucketTotalsKnown = progress.every((entry) => entry.initialized);

    setHasMorePages(hasMore);
    setSearchPage((prev) => ({
      ...prev,
      query: latestQuery ?? prev.query,
      total: totalLoadedAcrossKnownBuckets,
      hasMore,
      isTotalExact: allBucketTotalsKnown,
    }));
  }, [artistId, artistName]);

  const runSearch = useCallback(async () => {
    setIsSearching(true);
    setIsLoadingMore(false);
    loadMoreInFlightRef.current = false;
    setSearchPage(defaultSearchPage);
    setHasMorePages(false);
    bucketProgressRef.current = createInitialBucketProgress();
    activeBucketIndexRef.current = 0;
    setGroupReleases({});
    releasesRef.current = {};
    loadingRef.current.clear();
    setLoadingGroupIds({});
    setExpandedGroups({});

    try {
      await loadNextTypeBucketPage();
    } catch {
      toast.error('Failed to load artist releases. Please try again.');
    } finally {
      setIsSearching(false);
    }
  }, [loadNextTypeBucketPage]);

  useEffect(() => {
    void runSearch();
  }, [runSearch]);

  const loadMore = useCallback(async () => {
    if (isSearching || !hasMorePages || loadMoreInFlightRef.current) {
      return;
    }

    loadMoreInFlightRef.current = true;
    setIsLoadingMore(true);
    try {
      await loadNextTypeBucketPage();
    } catch {
      toast.error('Failed to load more artist releases. Please keep scrolling to retry.');
    } finally {
      loadMoreInFlightRef.current = false;
      setIsLoadingMore(false);
    }
  }, [hasMorePages, isSearching, loadNextTypeBucketPage]);

  useEffect(() => {
    if (!hasMorePages || isSearching) {
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
  }, [hasMorePages, isSearching, loadMore, searchPage.groups.length]);

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

  const groupedSections = useMemo(
    () => buildReleaseGroupSections(searchPage.groups),
    [searchPage.groups],
  );
  const totalLabel = searchPage.isTotalExact
    ? `${searchPage.total.toLocaleString()} matching release groups`
    : `${searchPage.total.toLocaleString()}+ matching release groups`;

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

      {!isSearching && searchPage.total > 0 && (
        <div className="mt-4 mb-4 text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
          <span>{totalLabel}</span>
          <span>{`${searchPage.groups.length.toLocaleString()} loaded`}</span>
        </div>
      )}

      {isSearching ? (
        <div className="space-y-3 mt-4" aria-label="Loading artist releases" role="status">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 bg-vinyl-800/60 rounded-2xl border border-white/5 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="mt-4 space-y-6">
          {groupedSections.map((section) => (
            <section key={section.key}>
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-300">{section.title}</h3>
                <span className="text-xs text-gray-500">{section.groups.length}</span>
              </div>

              <ReleaseGroupResultsList
                groups={section.groups}
                groupReleases={groupReleases}
                expandedGroups={expandedGroups}
                loadingGroupIds={loadingGroupIds}
                onToggleGroup={(group) => {
                  void toggleGroupExpanded(group.releaseGroupId);
                }}
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
                onArtistNameClick={(artistName) => {
                  void openArtistDetailFromCard(artistName);
                }}
              />
            </section>
          ))}
        </div>
      )}

      {!isSearching && searchPage.total === 0 && (
        <div className="text-center text-gray-500 mt-10">No release groups found for this artist.</div>
      )}

      {!isSearching && searchPage.total > 0 && (
        <div className="mt-8 flex flex-col items-center gap-2 text-xs text-gray-500">
          {hasMorePages ? (
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

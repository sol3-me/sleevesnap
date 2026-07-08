import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Scanner } from './components/Scanner';
import { VinylCard } from './components/VinylCard';
import { addRecord, getCollection, getUser, loginUser, logoutUser, removeRecord } from './services/storageService';
import { logEvent, logWarn } from './services/telemetry';
import { getReleaseGroupReleases, searchVinylReleaseGroups } from './services/vinylService';
import { SearchGroupReleases, SearchResultGroup, SearchResultPage, UserProfile, ViewState, VinylRecord } from './types';

const SEARCH_PAGE_SIZE = 5;
const SEARCH_FILTERS_KEY = 'sleevesnap:search-filters:v2';
const COLLECTION_CARD_SIZE_KEY = 'sleevesnap:collection-card-size:v1';
const COLLECTION_CARD_SIZE_MIN = 180;
const COLLECTION_CARD_SIZE_MAX = 360;
const DEFAULT_COLLECTION_CARD_SIZE = 240;

// Format filtering is client-side (see musicbrainz-data-model.md): the
// server returns every release-group unfiltered, enriched with its real
// formats, and these buckets group MusicBrainz's many raw format strings
// into checkboxes. Anything containing "Vinyl" or "CD" is grouped under one
// label (12" Vinyl, 10" Vinyl, 2xCD, CD-R, ... are just examples this
// substring match already catches, not an exhaustive list); everything else
// (Digital Media, Cassette, Unknown, ...) gets its own checkbox as-is.
const PRIORITY_FORMAT_BUCKETS = ['Vinyl', 'CD'];
const KNOWN_FORMAT_BUCKETS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'Vinyl', pattern: /vinyl|\blp\b/i },
  { name: 'CD', pattern: /\bcd\b/i },
];

function bucketForFormat(rawFormat: string): string {
  const known = KNOWN_FORMAT_BUCKETS.find((bucket) => bucket.pattern.test(rawFormat));
  return known ? known.name : rawFormat;
}

function bucketsForGroup(group: SearchResultGroup): string[] {
  return Array.from(new Set(group.availableFormats.map(bucketForFormat)));
}

// Sparse: only buckets the user has explicitly toggled are stored. Anything
// absent (including a bucket never seen before) defaults to checked/visible
// — the goal is to extract as much signal from MusicBrainz as possible
// rather than let a gap in its data quietly hide a real result.
type FormatFilterState = Record<string, boolean>;

const defaultSearchPage: SearchResultPage = {
  query: '',
  page: 1,
  pageSize: SEARCH_PAGE_SIZE,
  total: 0,
  hasMore: false,
  isTotalExact: true,
  groups: [],
};

function loadStoredFormatFilters(): FormatFilterState {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(SEARCH_FILTERS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: FormatFilterState = {};
    for (const [bucket, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') result[bucket] = value;
    }
    return result;
  } catch {
    return {};
  }
}

// --- Reusable UI Icons ---
const Icons = {
  Home: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>,
  Search: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>,
  Camera: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"></path><circle cx="12" cy="13" r="3"></circle></svg>,
  LogOut: () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>,
};

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [view, setView] = useState<ViewState>(ViewState.LOGIN);
  const [collection, setCollection] = useState<VinylRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchPage, setSearchPage] = useState<SearchResultPage>(defaultSearchPage);
  const [groupReleases, setGroupReleases] = useState<Record<string, SearchGroupReleases>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [loadingGroupIds, setLoadingGroupIds] = useState<Record<string, true>>({});
  const [formatFilters, setFormatFilters] = useState<FormatFilterState>(() => loadStoredFormatFilters());
  const [discoveredFormatBuckets, setDiscoveredFormatBuckets] = useState<string[]>([]);
  const [failedCovers, setFailedCovers] = useState<Record<string, true>>({});
  const [isSearching, setIsSearching] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [collectionCardSize, setCollectionCardSize] = useState<number>(() => loadStoredCollectionCardSize());
  const [isMobileLayout, setIsMobileLayout] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  );
  const [pendingScanImage, setPendingScanImage] = useState<string | null>(null);
  const [highlightedRecordId, setHighlightedRecordId] = useState<string | null>(null);
  const releasesRef = useRef<Record<string, SearchGroupReleases>>({});
  const loadingRef = useRef<Set<string>>(new Set());
  const highlightedCardRef = useRef<HTMLDivElement>(null);

  // Initialize
  useEffect(() => {
    const existingUser = getUser();
    if (existingUser) {
      setUser(existingUser);
      getCollection().then(setCollection);
      setView(ViewState.DASHBOARD);
    }
  }, []);

  const handleLogin = (name: string) => {
    const newUser = loginUser(name);
    setUser(newUser);
    getCollection().then(setCollection);
    setView(ViewState.DASHBOARD);
    showNotification(`Welcome back, ${name}!`);
  };

  const handleLogout = () => {
    logoutUser();
    setUser(null);
    setCollection([]);
    setView(ViewState.LOGIN);
  };

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  const handleAddToCollection = async (record: VinylRecord) => {
    const success = await addRecord(record);
    if (success) {
      logEvent('collection', 'Added to collection', { artist: record.artist, title: record.title });
      setCollection(await getCollection());
      showNotification(`Added "${record.title}" to collection`);
      // If we were searching, stay there, if scanning, go to dashboard
      if (view === ViewState.SCANNER) setView(ViewState.DASHBOARD);
    } else {
      logEvent('collection', 'Add skipped — already in collection', { artist: record.artist, title: record.title });
      showNotification(`"${record.title}" is already in your collection`);
    }
  };

  const handleRemoveFromCollection = async (id: string) => {
    await removeRecord(id);
    logEvent('collection', 'Removed from collection', { recordId: id });
    setCollection(await getCollection());
    showNotification("Record removed");
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SEARCH_FILTERS_KEY, JSON.stringify(formatFilters));
    } catch {
      // Ignore storage write failures.
    }
  }, [formatFilters]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(COLLECTION_CARD_SIZE_KEY, String(collectionCardSize));
    } catch {
      // Ignore storage write failures.
    }
  }, [collectionCardSize]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateLayout = () => setIsMobileLayout(window.innerWidth < 768);
    updateLayout();

    window.addEventListener('resize', updateLayout);
    return () => window.removeEventListener('resize', updateLayout);
  }, []);

  // Paste an image (e.g. a screenshot) from anywhere on the site to jump
  // straight into the scan flow — the desktop-friendly alternative to using
  // a webcam.
  useEffect(() => {
    if (!user) return;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageItem = Array.from(items).find((item) => item.type.startsWith('image/'));
      if (!imageItem) return;

      const file = imageItem.getAsFile();
      if (!file) return;

      e.preventDefault();

      const reader = new FileReader();
      reader.onloadend = () => {
        setPendingScanImage(reader.result as string);
        setView(ViewState.SCANNER);
      };
      reader.readAsDataURL(file);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [user]);

  // Scroll a just-confirmed "already in your collection" record into view and
  // briefly highlight it, then let the highlight fade on its own.
  useEffect(() => {
    if (!highlightedRecordId || view !== ViewState.DASHBOARD) return;

    highlightedCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timeout = setTimeout(() => setHighlightedRecordId(null), 2500);
    return () => clearTimeout(timeout);
  }, [highlightedRecordId, view]);

  const handleSearch = async (page = 1, queryOverride?: string) => {
    const queryToSearch = (queryOverride ?? searchQuery).trim();
    if (!queryToSearch) return;
    const isNewQuery = page === 1 && queryToSearch !== searchPage.query;
    setIsSearching(true);
    const startedAt = performance.now();

    try {
      const result = await searchVinylReleaseGroups(queryToSearch, page, SEARCH_PAGE_SIZE);
      logEvent('discover', 'Search results', {
        query: queryToSearch,
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
          for (const bucket of bucketsForGroup(group)) next.add(bucket);
        }
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
      logWarn('discover', 'Search failed', { query: queryToSearch, page, error: err instanceof Error ? err.message : String(err) });
      showNotification('Search failed. Please try again.');
    } finally {
      setIsSearching(false);
    }
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

  const isBucketChecked = useCallback(
    (bucket: string) => formatFilters[bucket] ?? true,
    [formatFilters],
  );

  const groupMatchesFilters = useCallback(
    (group: SearchResultGroup) => bucketsForGroup(group).some(isBucketChecked),
    [isBucketChecked],
  );

  const releaseMatchesFilters = useCallback(
    (format?: string) => isBucketChecked(bucketForFormat(format ?? 'Unknown')),
    [isBucketChecked],
  );

  const sortedBuckets = useMemo(() => {
    const priority = PRIORITY_FORMAT_BUCKETS.filter((bucket) => discoveredFormatBuckets.includes(bucket));
    const rest = discoveredFormatBuckets
      .filter((bucket) => bucket !== 'Unknown' && !PRIORITY_FORMAT_BUCKETS.includes(bucket))
      .sort((a, b) => a.localeCompare(b));
    const unknown = discoveredFormatBuckets.includes('Unknown') ? ['Unknown'] : [];
    return [...priority, ...rest, ...unknown];
  }, [discoveredFormatBuckets]);

  const filteredGroups = useMemo(
    () => searchPage.groups.filter(groupMatchesFilters),
    [searchPage.groups, groupMatchesFilters],
  );

  const totalPages = Math.max(1, Math.ceil(searchPage.total / searchPage.pageSize));

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

  // --- Views ---

  const LoginView = () => (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-gradient-to-br from-vinyl-900 via-black to-vinyl-800">
      <div className="w-full max-w-md bg-vinyl-800 p-8 rounded-2xl shadow-2xl border border-vinyl-700">
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 bg-vinyl-accent rounded-full flex items-center justify-center animate-spin-slow shadow-[0_0_20px_rgba(255,107,107,0.3)]">
            <div className="w-8 h-8 bg-vinyl-900 rounded-full"></div>
          </div>
        </div>
        <h1 className="text-3xl font-bold text-center mb-2 text-white">sleevesnap</h1>
        <p className="text-center text-gray-400 mb-8">Digitize your vinyl collection with AI.</p>

        <form onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          handleLogin(fd.get('name') as string || 'Guest');
        }}>
          <input
            name="name"
            type="text"
            placeholder="Enter your name"
            className="w-full bg-vinyl-900 text-white border border-vinyl-700 rounded-lg p-3 mb-4 focus:ring-2 focus:ring-vinyl-accent focus:outline-none transition-all"
            required
          />
          <button
            type="submit"
            className="w-full bg-vinyl-accent hover:bg-red-500 text-white font-bold py-3 rounded-lg transition-colors shadow-lg"
          >
            Start Collecting
          </button>
        </form>
      </div>
    </div>
  );

  const DashboardView = () => (
    <div className="p-4 md:p-8 pb-24">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h2 className="text-3xl font-bold text-white">Your Collection</h2>
          <p className="text-gray-400">{collection.length} Records</p>
        </div>
        <div className="hidden md:flex items-center gap-3 px-3 py-2 rounded-lg border border-vinyl-700 bg-vinyl-800/70">
          <span className="text-xs uppercase tracking-wide text-gray-400">Size</span>
          <input
            type="range"
            min={COLLECTION_CARD_SIZE_MIN}
            max={COLLECTION_CARD_SIZE_MAX}
            step={10}
            value={collectionCardSize}
            onChange={(e) => setCollectionCardSize(clampCollectionCardSize(Number(e.target.value)))}
            className="w-28 accent-vinyl-accent"
            aria-label="Collection card size"
          />
          <span className="text-xs text-gray-500 w-10 text-right">{collectionCardSize}</span>
        </div>
        <button
          onClick={() => setView(ViewState.SCANNER)}
          className="md:hidden bg-vinyl-accent text-white p-3 rounded-full shadow-lg"
        >
          <Icons.Camera />
        </button>
      </div>

      {collection.length === 0 ? (
        <div className="text-center py-20 bg-vinyl-800/50 rounded-xl border border-dashed border-vinyl-700">
          <p className="text-xl text-gray-400 mb-4">It's quiet in here...</p>
          <button
            onClick={() => setView(ViewState.SEARCH)}
            className="text-vinyl-accent underline hover:text-white"
          >
            Add your first record
          </button>
        </div>
      ) : (
        <div
          className="grid gap-4 md:gap-6"
          style={
            isMobileLayout
              ? { gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(140px, 44vw, 190px), 1fr))' }
              : {
                gridTemplateColumns: `repeat(auto-fill, minmax(${collectionCardSize}px, ${collectionCardSize}px))`,
                justifyContent: 'flex-start',
              }
          }
        >
          {collection.map(record => (
            <div
              key={record.id}
              ref={record.id === highlightedRecordId ? highlightedCardRef : undefined}
              className={
                record.id === highlightedRecordId
                  ? 'rounded-lg ring-4 ring-vinyl-accent ring-offset-2 ring-offset-vinyl-900 transition-shadow'
                  : undefined
              }
            >
              <VinylCard record={record} onRemove={handleRemoveFromCollection} />
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderSearchView = () => (
    <div className="p-4 md:p-8 pb-24">
      <h2 className="text-3xl font-bold text-white mb-6">Discover Vinyl</h2>
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch(1)}
            placeholder="Search artist or album..."
            className="flex-1 bg-vinyl-800 text-white border border-vinyl-700 rounded-lg p-3 focus:ring-1 focus:ring-vinyl-accent focus:outline-none"
          />
          <button
            onClick={() => handleSearch(1)}
            disabled={isSearching}
            className="bg-vinyl-700 hover:bg-vinyl-600 text-white px-6 rounded-lg transition-colors font-medium disabled:opacity-50"
          >
            {isSearching ? '...' : 'Search'}
          </button>
        </div>
        {sortedBuckets.length > 0 && (
          <div className="flex flex-wrap items-center gap-5 text-sm text-gray-300">
            {sortedBuckets.map((bucket) => (
              <label key={bucket} className="inline-flex items-center gap-2 select-none">
                <input
                  type="checkbox"
                  checked={formatFilters[bucket] ?? true}
                  onChange={(e) =>
                    setFormatFilters((prev) => ({
                      ...prev,
                      [bucket]: e.target.checked,
                    }))
                  }
                  className="accent-vinyl-accent"
                />
                {bucket}
              </label>
            ))}
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
          const isExpanded = Boolean(expandedGroups[group.releaseGroupId]);
          const loadingGroup = Boolean(loadingGroupIds[group.releaseGroupId]);
          const releaseCount = group.totalReleases;
          const canExpand = releaseCount > 1;
          const discogsSearchUrl = `https://www.discogs.com/search/?q=${encodeURIComponent(
            `${group.artist} ${group.title}`,
          )}&type=master`;
          const discogsGroupUrl = group.discogsMasterUrl ?? details?.discogsMasterUrl ?? discogsSearchUrl;

          return (
            <div key={group.releaseGroupId} className="bg-vinyl-800 rounded-xl border border-vinyl-700 overflow-hidden">
              <button
                onClick={() => toggleGroupExpanded(group)}
                className="w-full text-left p-4 flex gap-4 hover:bg-vinyl-700/30 transition-colors"
              >
                <div className="w-20 h-20 rounded-md overflow-hidden border border-vinyl-700 shrink-0 bg-vinyl-900">
                  {renderCoverThumb(`group-${group.releaseGroupId}`, group.title, group.thumbnailUrl, 'No group art')}
                </div>

                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold text-white truncate">{group.title}</h3>
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

                <div className="self-center">
                  <div className="min-w-[180px] px-4 py-3 rounded-lg border border-vinyl-600 bg-vinyl-900 text-sm text-gray-200 flex items-center justify-center gap-2">
                    <span>{canExpand ? (isExpanded ? 'Hide releases' : 'Show releases') : 'Single release'}</span>
                    <span className={`text-base leading-none transition-transform ${isExpanded ? 'rotate-180' : ''}`}>⌄</span>
                  </div>
                </div>
              </button>

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

                  {filteredReleases.map((record) => {
                    const country = formatCountry(record.country);
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
                            onClick={() => handleAddToCollection(record)}
                            className="self-end text-xs bg-vinyl-accent hover:bg-red-500 text-white px-3 py-1 rounded transition-colors"
                          >
                            Add to Collection
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!isSearching && searchQuery && searchPage.total === 0 && (
        <div className="text-center text-gray-500 mt-10">
          No results found. Try a different query.
        </div>
      )}

      {!isSearching && searchQuery && searchPage.total > 0 && filteredGroups.length === 0 && (
        <div className="text-center text-gray-500 mt-10">
          {`${searchPage.groups.length} release group${searchPage.groups.length === 1 ? '' : 's'} found on this page, but none match your selected formats above.`}
        </div>
      )}

      {(searchPage.hasMore || searchPage.page > 1) && (
        <div className="mt-8 flex items-center justify-center gap-2">
          <button
            disabled={searchPage.page <= 1 || isSearching}
            onClick={() => handleSearch(searchPage.page - 1)}
            className="px-4 py-2 rounded bg-vinyl-800 border border-vinyl-700 disabled:opacity-50"
          >
            Prev
          </button>
          <span className="text-sm text-gray-400 px-2">{`Page ${searchPage.page} / ${totalPages}`}</span>
          <button
            disabled={!searchPage.hasMore || isSearching}
            onClick={() => handleSearch(searchPage.page + 1)}
            className="px-4 py-2 rounded bg-vinyl-800 border border-vinyl-700 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );

  // --- Main Layout Render ---

  if (!user || view === ViewState.LOGIN) {
    return <LoginView />;
  }

  return (
    <div className="flex h-screen bg-vinyl-900 text-white overflow-hidden">

      {/* Sidebar (Desktop) */}
      <aside className="hidden md:flex flex-col w-64 bg-vinyl-800 border-r border-vinyl-700">
        <div className="p-6">
          <h1 className="text-2xl font-bold text-vinyl-accent flex items-center gap-2">
            <span className="w-3 h-3 bg-white rounded-full"></span>
            sleevesnap
          </h1>
        </div>
        <nav className="flex-1 px-4 space-y-2">
          <button
            onClick={() => setView(ViewState.DASHBOARD)}
            className={`flex items-center gap-3 w-full p-3 rounded-lg transition-all ${view === ViewState.DASHBOARD ? 'bg-vinyl-accent text-white' : 'text-gray-400 hover:bg-vinyl-700'}`}
          >
            <Icons.Home /> Home
          </button>
          <button
            onClick={() => setView(ViewState.SEARCH)}
            className={`flex items-center gap-3 w-full p-3 rounded-lg transition-all ${view === ViewState.SEARCH ? 'bg-vinyl-accent text-white' : 'text-gray-400 hover:bg-vinyl-700'}`}
          >
            <Icons.Search /> Search
          </button>
          <button
            onClick={() => setView(ViewState.SCANNER)}
            className={`flex items-center gap-3 w-full p-3 rounded-lg transition-all ${view === ViewState.SCANNER ? 'bg-vinyl-accent text-white' : 'text-gray-400 hover:bg-vinyl-700'}`}
          >
            <Icons.Camera /> Scan
          </button>
        </nav>
        <div className="p-4 border-t border-vinyl-700">
          <div className="flex items-center gap-3 mb-4">
            <img src={user.avatarUrl} alt="Avatar" className="w-8 h-8 rounded-full bg-gray-600" />
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-bold truncate">{user.name}</p>
              <p className="text-xs text-gray-500 truncate">{user.email}</p>
            </div>
          </div>
          <button onClick={handleLogout} className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300">
            <Icons.LogOut /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 relative overflow-y-auto h-full scroll-smooth">

        {/* Mobile Header */}
        <header className="md:hidden flex justify-between items-center p-4 bg-vinyl-800/90 backdrop-blur-md sticky top-0 z-20 border-b border-vinyl-700">
          <h1 className="text-xl font-bold text-vinyl-accent">sleevesnap</h1>
          <img src={user.avatarUrl} alt="User" className="w-8 h-8 rounded-full" />
        </header>

        {/* Dynamic View */}
        {view === ViewState.SCANNER ? (
          <Scanner
            isMobileLayout={isMobileLayout}
            initialImage={pendingScanImage}
            onInitialImageConsumed={() => setPendingScanImage(null)}
            onCancel={() => setView(ViewState.DASHBOARD)}
            onScanComplete={async (record) => {
              setCollection(await getCollection());
              setView(ViewState.DASHBOARD);
              showNotification(`Added "${record.title}" to collection!`);
            }}
            onAlreadyInCollection={(record) => {
              // Already in the collection — no save happened, so no need to
              // refetch it. Just take the user back and point at it.
              setView(ViewState.DASHBOARD);
              showNotification(`"${record.title}" is already in your collection`);
              setHighlightedRecordId(record.id);
            }}
          />
        ) : view === ViewState.SEARCH ? (
          renderSearchView()
        ) : (
          <DashboardView />
        )}

        {/* Mobile Navigation Bar (Bottom Sticky) */}
        {view !== ViewState.SCANNER && (
          <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-vinyl-800 border-t border-vinyl-700 flex justify-around p-3 z-30 pb-safe">
            <button onClick={() => setView(ViewState.DASHBOARD)} className={`flex flex-col items-center ${view === ViewState.DASHBOARD ? 'text-vinyl-accent' : 'text-gray-500'}`}>
              <Icons.Home />
              <span className="text-xs mt-1">Home</span>
            </button>
            <button onClick={() => setView(ViewState.SCANNER)} className="flex flex-col items-center -mt-8">
              <div className="bg-vinyl-accent p-4 rounded-full shadow-lg border-4 border-vinyl-900 text-white">
                <Icons.Camera />
              </div>
            </button>
            <button onClick={() => setView(ViewState.SEARCH)} className={`flex flex-col items-center ${view === ViewState.SEARCH ? 'text-vinyl-accent' : 'text-gray-500'}`}>
              <Icons.Search />
              <span className="text-xs mt-1">Search</span>
            </button>
          </nav>
        )}

        {/* Global Notification Toast */}
        {notification && (
          <div className="fixed top-20 right-4 md:bottom-8 md:top-auto md:right-8 bg-white text-black px-6 py-3 rounded-lg shadow-xl animate-bounce z-50 font-medium">
            {notification}
          </div>
        )}
      </main>
    </div>
  );
}

function clampCollectionCardSize(value: number): number {
  return Math.max(COLLECTION_CARD_SIZE_MIN, Math.min(COLLECTION_CARD_SIZE_MAX, value));
}

function loadStoredCollectionCardSize(): number {
  if (typeof window === 'undefined') {
    return DEFAULT_COLLECTION_CARD_SIZE;
  }

  try {
    const raw = window.localStorage.getItem(COLLECTION_CARD_SIZE_KEY);
    if (!raw) return DEFAULT_COLLECTION_CARD_SIZE;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return DEFAULT_COLLECTION_CARD_SIZE;
    return clampCollectionCardSize(parsed);
  } catch {
    return DEFAULT_COLLECTION_CARD_SIZE;
  }
}
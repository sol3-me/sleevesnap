import { useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Icons } from '../components/Icons';
import { VinylCard } from '../components/VinylCard';
import { collectionQueryKey, useCollectionQuery, useRemoveFromCollectionMutation } from '../hooks/useCollection';
import { useIsMobileLayout } from '../hooks/useIsMobileLayout';
import { resolveArtistEntityByName } from '../lib/entityResolvers';
import { VinylRecord } from '../types';

const routeApi = getRouteApi('/');

const COLLECTION_CARD_SIZE_KEY = 'sleevesnap:collection-card-size:v1';
const COLLECTION_CARD_SIZE_MIN = 180;
const COLLECTION_CARD_SIZE_MAX = 360;
const DEFAULT_COLLECTION_CARD_SIZE = 240;
// How long "Undo" stays clickable after removing a record before the delete
// actually reaches the server. Matched to the toast's own visible duration
// below so the affordance never disappears before the action it undoes.
const REMOVE_UNDO_WINDOW_MS = 5000;

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

export function CollectionView() {
  const { highlight } = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const { data: collection } = useCollectionQuery();
  const removeMutation = useRemoveFromCollectionMutation();
  const queryClient = useQueryClient();
  const isMobileLayout = useIsMobileLayout();
  const [collectionCardSize, setCollectionCardSize] = useState<number>(() => loadStoredCollectionCardSize());
  const highlightedCardRef = useRef<HTMLDivElement>(null);
  // Records the user has just removed but hasn't been sent to the server
  // yet, keyed by record id — gives the "Undo" toast action a window to
  // cancel the delete before it actually happens.
  const pendingRemovalsRef = useRef<Record<string, { record: VinylRecord; timeoutId: ReturnType<typeof setTimeout> }>>({});

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(COLLECTION_CARD_SIZE_KEY, String(collectionCardSize));
    } catch {
      // Ignore storage write failures.
    }
  }, [collectionCardSize]);

  // Cancel any in-flight "undo window" deletes on unmount so we never call
  // the remove mutation against a component that's gone away.
  useEffect(() => {
    return () => {
      for (const id of Object.keys(pendingRemovalsRef.current)) {
        clearTimeout(pendingRemovalsRef.current[id].timeoutId);
      }
    };
  }, []);

  // Scroll a just-confirmed "already in your collection" record into view and
  // briefly highlight it, then clear the `highlight` search param so a
  // refresh or share of the URL doesn't keep re-triggering the animation.
  useEffect(() => {
    if (!highlight) return;

    highlightedCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timeout = setTimeout(() => {
      void navigate({ search: {}, replace: true });
    }, 2500);
    return () => clearTimeout(timeout);
  }, [highlight, navigate]);

  // Optimistically hides the record immediately, but only actually deletes it
  // server-side after a short grace period — the "Undo" toast action cancels
  // the pending delete and restores it. One mis-tap on mobile shouldn't
  // permanently destroy a collection entry with no way back.
  const handleRemoveFromCollection = (id: string) => {
    const record = collection.find((r) => r.id === id);
    if (!record) return;

    queryClient.setQueryData<VinylRecord[]>(collectionQueryKey, (prev) => (prev ?? []).filter((r) => r.id !== id));

    const timeoutId = setTimeout(() => {
      delete pendingRemovalsRef.current[id];
      removeMutation.mutate(id, {
        onError: () => {
          void queryClient.invalidateQueries({ queryKey: collectionQueryKey });
          toast.error(`Failed to remove "${record.title}"`);
        },
      });
    }, REMOVE_UNDO_WINDOW_MS);

    pendingRemovalsRef.current[id] = { record, timeoutId };

    toast(`Removed "${record.title}"`, {
      duration: REMOVE_UNDO_WINDOW_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          const pending = pendingRemovalsRef.current[id];
          if (!pending) return;
          clearTimeout(pending.timeoutId);
          delete pendingRemovalsRef.current[id];
          queryClient.setQueryData<VinylRecord[]>(collectionQueryKey, (prev) => [pending.record, ...(prev ?? [])]);
        },
      },
    });
  };

  const openArtistDetail = useCallback(async (artistName: string) => {
    const trimmed = artistName.trim();
    if (!trimmed) return;

    try {
      const artist = await resolveArtistEntityByName(trimmed);
      if (!artist) {
        toast.error('Could not find a matching artist detail page.');
        return;
      }

      void navigate({
        to: '/artists/$artistId',
        params: { artistId: artist.id },
        search: { name: artist.name, page: 1 },
      });
    } catch {
      toast.error('Failed to open artist detail page. Please try again.');
    }
  }, [navigate]);

  return (
    <div className="p-4 md:p-8 pb-28 md:pb-24">
      {/* Desktop-only quick-add FAB — mobile covers this with the bottom
          nav's raised scan button. */}
      <Link
        to="/discover"
        className="hidden md:flex fixed bottom-8 right-8 items-center gap-2 bg-gradient-to-br from-vinyl-accent to-red-500 hover:from-vinyl-accent-soft hover:to-red-400 text-white pl-4 pr-5 py-3 rounded-full font-semibold text-sm shadow-lg shadow-vinyl-accent/25 transition-all hover:-translate-y-0.5 z-30"
      >
        <Icons.Plus />
        Add Record
      </Link>

      <div className="flex justify-between items-center mb-6 md:mb-8">
        <div className="flex items-baseline gap-3">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white">Collection</h2>
          <span className="px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-gray-400">
            {collection.length} {collection.length === 1 ? 'record' : 'records'}
          </span>
        </div>
        <div className="hidden md:flex items-center gap-3 px-3.5 py-2 rounded-full border border-white/10 bg-white/5">
          <span className="text-[11px] uppercase tracking-wider text-gray-500">Size</span>
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
        </div>
      </div>

      {collection.length === 0 ? (
        <div className="flex flex-col items-center text-center py-20 px-6 bg-vinyl-900/60 rounded-3xl border border-dashed border-white/10">
          <div className="text-gray-600 mb-4 animate-spin-slow">
            <Icons.Disc />
          </div>
          <p className="text-lg font-semibold text-white mb-1">No records yet</p>
          <p className="text-sm text-gray-500 mb-6 max-w-60">
            Scan a sleeve with your camera or search the catalog to start your collection.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              to="/discover"
              className="inline-flex items-center gap-2 bg-gradient-to-br from-vinyl-accent to-red-500 hover:from-vinyl-accent-soft hover:to-red-400 text-white px-5 py-2.5 rounded-full font-semibold text-sm transition-colors"
            >
              <Icons.Plus /> Search the catalog
            </Link>
            <Link
              to="/scan"
              className="inline-flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200 px-5 py-2.5 rounded-full font-semibold text-sm transition-colors"
            >
              Scan a sleeve
            </Link>
          </div>
        </div>
      ) : (
        <div
          className="grid gap-3 md:gap-5"
          style={
            isMobileLayout
              ? { gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }
              : {
                gridTemplateColumns: `repeat(auto-fill, minmax(${collectionCardSize}px, ${collectionCardSize}px))`,
                justifyContent: 'flex-start',
              }
          }
        >
          {collection.map(record => (
            <div
              key={record.id}
              ref={record.id === highlight ? highlightedCardRef : undefined}
              className={
                record.id === highlight
                  ? 'rounded-2xl ring-2 ring-vinyl-accent ring-offset-4 ring-offset-vinyl-950 transition-shadow'
                  : undefined
              }
            >
              <VinylCard
                record={record}
                onRemove={handleRemoveFromCollection}
                onArtistClick={(artistName) => {
                  void openArtistDetail(artistName);
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

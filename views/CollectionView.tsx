import { useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Icons } from '../components/Icons';
import { VinylCard } from '../components/VinylCard';
import { collectionQueryKey, useCollectionQuery, useRemoveFromCollectionMutation } from '../hooks/useCollection';
import { useIsMobileLayout } from '../hooks/useIsMobileLayout';
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

  return (
    <div className="p-4 md:p-8 pb-24">
      {/* Desktop-only quick-add FAB — mobile already has the camera button in
          the header row above plus the bottom nav's scan button. */}
      <Link
        to="/discover"
        className="hidden md:flex fixed bottom-8 right-8 items-center gap-2 bg-vinyl-accent hover:bg-red-500 text-white px-5 py-3 rounded-full shadow-lg transition-colors z-30"
      >
        <Icons.Search />
        <span className="font-medium">Add Record</span>
      </Link>

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
        <Link to="/scan" className="md:hidden bg-vinyl-accent text-white p-3 rounded-full shadow-lg">
          <Icons.Camera />
        </Link>
      </div>

      {collection.length === 0 ? (
        <div className="text-center py-20 bg-vinyl-800/50 rounded-xl border border-dashed border-vinyl-700">
          <p className="text-xl text-gray-400 mb-4">It's quiet in here...</p>
          <Link to="/discover" className="text-vinyl-accent underline hover:text-white">
            Add your first record
          </Link>
        </div>
      ) : (
        <div
          className="grid gap-4 md:gap-6"
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
}
